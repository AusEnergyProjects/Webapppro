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
const user = { uid: "actor", getIdToken: async () => "test-token" };

function libraryModule(file) {
  const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  Function("exports", compiled)(exports);
  return exports;
}
const formLibraryContract = libraryModule("trade-job-form-library.ts");
const governmentCatalogue = libraryModule("australian-government-program-catalogue.ts");
const programme = governmentCatalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(item => item.jurisdiction === "VIC" && item.catalogueState === "current");
const activity = governmentCatalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find(item => item.programCode === programme.programCode && item.catalogueState === "current");
const businessSelection = (key = "business-scope", version = 2) => ({ kind: "business", templateKey: key, templateVersion: version, name: `Form ${key}` });
const rentalSelection = { kind: "rental", moduleKey: "minimum_standards", name: "Rental minimum standards assessment" };
const creditexSelection = { kind: "creditex", programTemplateId: programme.templateId, activityTemplateId: activity.templateId, name: activity.title };
const piesaSelection = { kind: "piesa", name: "Pre-installation electrical safety assessment (Insulation)" };
const formOption = (selection = businessSelection(), extra = {}) => ({
  id: formLibraryContract.tradeJobFormSelectionId(selection), name: selection.name,
  group: selection.kind === "business" ? "Business forms" : selection.kind === "rental" ? "Rental assessments" : "Creditex forms",
  jurisdiction: selection.kind === "business" ? "AU" : "VIC", description: `Complete ${selection.name}`,
  categories: ["assessment"], searchText: selection.kind === "creditex" ? `${programme.programCode} ${activity.registryActivityCode || activity.activityKey}` : selection.kind === "piesa" ? "PIESA insulation" : "", selection,
  unavailableReason: "", ...extra,
});
const row = (tree, name) => nodes(tree, node => node.type === "article" && text(node).includes(name))[0];
const inputValue = (tree, name) => nodes(tree, node => node.type === "input" && node.props.name === name)[0]?.props.value;
const libraryIn = tree => nodes(tree, node => node.type === "form-library")[0];

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

function picker({ respond = async () => Response.json({ ok: true, options: [formOption()] }), selectedIds = [], onSelect, ...initial } = {}) {
  const requests = [], changes = [];
  let h;
  const fetch = async (url, init) => { requests.push({ url, init }); return respond(url, init); };
  h = harness("TradeJobFormLibrary.tsx", "TradeJobFormLibrary", { user, serviceCategory: "assessment", addressState: "VIC", buildingType: "house_townhouse", selectedIds, ...initial,
    async onSelect(option, revision) { changes.push({ option, revision }); if (onSelect) await onSelect(option, revision); else h.update({ selectedIds: [option.id] }); } }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: "owner" }) },
  });
  return { ...h, requests, changes };
}

test("new-job library requests actual form metadata for the current business, jurisdiction and premises", async () => {
  const h = picker();
  let tree = await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/api/trade-job-form-library?serviceCategory=assessment&addressState=VIC&buildingType=house_townhouse");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer test-token");
  assert.equal(h.requests[0].init.cache, "no-store");
  button(tree, "Add form").props.onClick();
  await tick();
  tree = h.render();
  assert.deepEqual(h.changes, [{ option: formOption(), revision: undefined }]);
  assert.equal(button(tree, "Selected").props.disabled, true);
  button(tree, "Selected").props.onClick();
  assert.equal(h.changes.length, 1);
});

test("one searchable library shows actual rental, Creditex, PIESA and business choices", async () => {
  const options = [formOption(rentalSelection), formOption(creditexSelection), formOption(piesaSelection), formOption()];
  const h = picker({ respond: async () => Response.json({ ok: true, options }) });
  let tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "article").length, 4);
  assert.deepEqual(nodes(tree, node => node.type === "h4").map(text), ["Rental assessments", "Creditex forms", "Business forms"]);
  assert.doesNotMatch(text(tree), /Pre-start risk and site readiness|Scheduled service visit record/);
  const search = value => { nodes(tree, node => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value } }); tree = h.render(); };
  search("  RENTAL  "); assert.equal(nodes(tree, node => node.type === "article").length, 1); assert.ok(row(tree, rentalSelection.name));
  search("PIESA"); assert.equal(nodes(tree, node => node.type === "article").length, 1); assert.ok(row(tree, piesaSelection.name));
  search("Creditex"); assert.equal(nodes(tree, node => node.type === "article").length, 2);
  search("business-scope"); assert.equal(nodes(tree, node => node.type === "article").length, 1);
  search("no such form"); assert.match(text(tree), /No forms match your search/); assert.equal(nodes(tree, node => node.type === "article").length, 0);
  assert.equal(h.requests.length, 1, "Local search does not issue another catalogue request");
});

test("library failure is truthful and a retry loads choices without changing selections", async () => {
  let calls = 0;
  const h = picker({ respond: async () => ++calls === 1 ? Response.json({ error: "Permission changed" }, { status: 403 }) : Response.json({ ok: true, options: [formOption()] }) });
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
  const h = picker({ respond: async (url) => new URL(url, "https://tlink.test").searchParams.get("serviceCategory") === "assessment" ? new Promise((resolve) => { resolveOld = resolve; }) : Response.json({ ok: true, options: [formOption(businessSelection("insulation"))] }) });
  h.render(); await tick();
  h.update({ serviceCategory: "insulation" });
  let tree = await h.settle();
  assert.equal(h.requests[0].init.signal.aborted, true);
  resolveOld(Response.json({ ok: true, options: [formOption(businessSelection("old"))] }));
  tree = await h.settle();
  assert.match(text(tree), /Form insulation/);
  assert.doesNotMatch(text(tree), /Form old/);
  h.unmount();
  assert.equal(h.requests[1].init.signal.aborted, true);
});

test("unavailable forms remain discoverable with their reason and cannot be selected", async () => {
  const unavailable = formOption(businessSelection("wrong-category"), { unavailableReason: "Choose rooftop solar work before adding this business form." });
  const h = picker({ respond: async () => Response.json({ ok: true, options: [unavailable] }) });
  const tree = await h.settle();
  assert.match(text(tree), /Choose rooftop solar work/);
  assert.equal(nodes(tree, node => node.type === "article").length, 1);
  assert.equal(button(tree, "Add form").props.disabled, true);
  button(tree, "Add form").props.onClick(); await tick(); assert.equal(h.changes.length, 0);
});

test("selected, already attached and read-only forms cannot be added again", async () => {
  const h = picker({ selectedIds: [formOption().id] });
  let tree = await h.settle();
  assert.equal(button(tree, "Selected").props.disabled, true);
  button(tree, "Selected").props.onClick();
  assert.equal(h.changes.length, 0);
  h.update({ selectedIds: [], disabled: true });
  tree = h.render();
  assert.equal(button(tree, "Add form").props.disabled, true);
  button(tree, "Add form").props.onClick();
  assert.equal(h.changes.length, 0);
  const saved = picker({ workOrderId: "saved job", respond: async () => Response.json({ ok: true, revision: 7, options: [formOption(rentalSelection, { added: true })] }) });
  tree = await saved.settle();
  assert.equal(saved.requests[0].url, "/api/trade-job-form-library?workOrderId=saved+job");
  assert.equal(button(tree, "Added").props.disabled, true);
  button(tree, "Added").props.onClick(); await tick(); assert.equal(saved.changes.length, 0);
});

test("rapid repeated adds use one in-flight selection and pass the exact saved-job revision", async () => {
  let finish;
  const h = picker({ workOrderId: "saved-job", respond: async () => Response.json({ ok: true, revision: 14, options: [formOption(rentalSelection)] }), onSelect: () => new Promise(resolve => { finish = resolve; }) });
  let tree = await h.settle();
  const add = button(tree, "Add form"); add.props.onClick(); add.props.onClick();
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0].revision, 14);
  tree = h.render(); assert.equal(button(tree, "Adding...").props.disabled, true);
  finish(); await tick(); tree = h.render(); assert.equal(button(tree, "Add form").props.disabled, false);
});

test("saved-job catalogue requires a usable revision before offering attachments", async () => {
  for (const revision of [undefined, "7", 1.5]) {
    const h = picker({ workOrderId: "saved-job", respond: async () => Response.json({ ok: true, revision, options: [formOption(rentalSelection)] }) });
    const tree = await h.settle();
    assert.match(text(tree), /Retry before adding a form/); assert.equal(nodes(tree, node => node.type === "article").length, 0); assert.equal(h.changes.length, 0);
  }
});

test("changing jurisdiction, premises or job hides old choices immediately and aborts their requests", async () => {
  const h = picker(); await h.settle();
  h.update({ addressState: "NSW", buildingType: "commercial_office" });
  let tree = h.render(); assert.match(text(tree), /Loading form library/); assert.equal(nodes(tree, node => node.type === "article").length, 0);
  tree = await h.settle();
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.match(h.requests[1].url, /addressState=NSW&buildingType=commercial_office/);
  h.update({ workOrderId: "different-job" }); tree = h.render(); assert.match(text(tree), /Loading form library/);
  await h.settle(); assert.equal(h.requests[1].init.signal.aborted, true);
  assert.equal(h.requests[2].url, "/api/trade-job-form-library?workOrderId=different-job");
});

function wizard(extra = {}, dependencies = {}) {
  let lazyIndex = 0;
  const fetch = async () => Response.json({});
  return harness("TradeNewJobForm.tsx", "TradeNewJobForm", { user, templates: [], teamMembers: [{ id: "self", displayName: "Actor", status: "active", isSelf: true }], allowCustomerSearch: false, canAssignJobs: false, busy: false, onSubmit() {}, ...extra }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch },
    "./SearchableLookup": { SearchableLookup: "customer-search" },
    "./AustralianAddressLookup": { AustralianAddressLookup: "address-picker" },
    "./RecoverableTradeWorkspace": { recoverableTradeWorkspace: () => lazyIndex++ === 0 ? "schedule-workspace" : "form-library" },
    "@/lib/trade-schedule": { nextAppointmentSlot: () => "2026-10-09T09:00", scheduleProposalKey: () => "proposal" },
    "@/lib/australian-government-program-catalogue": governmentCatalogue,
    "@/lib/trade-job-form-library": formLibraryContract,
    "@/lib/australian-certificate-calculation-catalogue": { GOVERNMENT_ACTIVITY_CALCULATION_METHODS: [] },
    "@/lib/rental-safety-visit.mjs": { RENTAL_VISIT_PRESETS: [] },
    "@/lib/energy-service-catalogue.mjs": { ENERGY_SERVICE_OPTIONS },
    "@/lib/trade-compliance-intent": { activityPremisesVariantId: () => "", activityRequiresPremisesVariant: () => false },
    ...dependencies,
  });
}

async function openForms(h) {
  let tree = h.render();
  button(tree, "Add customer").props.onClick();
  tree = h.render();
  button(tree, "Choose forms").props.onClick();
  tree = await h.settle();
  button(tree, "Add form").props.onClick();
  return h.render();
}

test("desktop wizard exposes Add form beside Add activity and includes exact selection in create payload and review", async () => {
  const h = wizard();
  let tree = await openForms(h);
  const formPicker = libraryIn(tree);
  assert.equal(formPicker.props.serviceCategory, "assessment");
  const toolbar = nodes(tree, (node) => node.props?.className === "crm-wizard-actions crm-add-activity-action")[0];
  assert.equal(button(toolbar, "Add activity").type, "button");
  assert.ok(button(toolbar, "Close form library"));
  formPicker.props.onSelect(formOption({ ...businessSelection("scope", 3), name: "Business scope" }));
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
  libraryIn(tree).props.onSelect(formOption({ ...businessSelection("scope", 3), name: "Old scope" }));
  tree = h.render();
  nodes(tree, (node) => node.type === "select" && node.props.name === "serviceCategory")[0].props.onChange({ target: { value: "insulation" } });
  tree = h.render();
  assert.equal(nodes(tree, (node) => node.props?.name === "formSelectionsJson")[0].props.value, "[]");
  assert.equal(nodes(tree, (node) => node.type === "form-library").length, 0);
  assert.doesNotMatch(text(tree), /Old scope/);
});

test("restricted desktop creator has no form attachment controls and retains ordinary job setup", () => {
  const h = wizard({ canManageFieldEvidence: false });
  const tree = h.render();
  assert.equal(button(tree, "Add form"), undefined);
  assert.ok(button(tree, "Add customer"));
  assert.equal(nodes(tree, (node) => node.props?.name === "formSelectionsJson")[0].props.value, "[]");
});

test("ordinary job starts with no implicit rental module and all four form kinds use their canonical payloads", async () => {
  const h = wizard();
  let tree = await openForms(h);
  assert.equal(inputValue(tree, "rentalInspectionModulesJson"), "[]");
  assert.equal(inputValue(tree, "attachVeuElectricalAssessment"), "false");
  assert.equal(inputValue(tree, "complianceActivitiesJson"), "[]");
  const options = [formOption(), formOption(rentalSelection), formOption(creditexSelection), formOption(piesaSelection)];
  for (const option of options) { libraryIn(tree).props.onSelect(option); tree = h.render(); }
  assert.deepEqual(JSON.parse(inputValue(tree, "formSelectionsJson")), [{ templateKey: "business-scope", templateVersion: 2 }]);
  assert.deepEqual(JSON.parse(inputValue(tree, "rentalInspectionModulesJson")), ["minimum_standards"]);
  assert.deepEqual(JSON.parse(inputValue(tree, "complianceActivitiesJson")), [{ programTemplateId: programme.templateId, activityTemplateId: activity.templateId }]);
  assert.equal(inputValue(tree, "attachVeuElectricalAssessment"), "true");
  assert.equal(inputValue(tree, "complianceIntentMode"), "planned");
  assert.deepEqual(libraryIn(tree).props.selectedIds, options.map(option => option.id));
  const review = nodes(tree, node => node.props?.["data-step"] === "5")[0];
  for (const option of options) assert.ok(text(review).includes(option.name), `${option.name} is shown in review`);
  assert.equal(nodes(tree, node => node.type === "select" && node.props.name === "appointmentType")[0].props.value, "installation");
  for (const option of options) {
    button(tree, `Remove ${option.name}`).props.onClick(); tree = h.render();
    assert.ok(!libraryIn(tree).props.selectedIds.includes(option.id));
  }
  assert.equal(inputValue(tree, "formSelectionsJson"), "[]");
  assert.equal(inputValue(tree, "rentalInspectionModulesJson"), "[]");
  assert.equal(inputValue(tree, "complianceActivitiesJson"), "[]");
  assert.equal(inputValue(tree, "attachVeuElectricalAssessment"), "false");
  assert.equal(nodes(tree, node => node.type === "select" && node.props.name === "appointmentType")[0].props.value, "site_visit");
});

test("wizard prevents busy, unavailable, duplicate keys and more than twenty business selections", async () => {
  const h = wizard(); let tree = await openForms(h);
  libraryIn(tree).props.onSelect(formOption()); tree = h.render();
  libraryIn(tree).props.onSelect(formOption(businessSelection("business-scope", 3))); tree = h.render();
  assert.equal(JSON.parse(inputValue(tree, "formSelectionsJson")).length, 1, "One business template key cannot be selected at two versions");
  libraryIn(tree).props.onSelect(formOption(rentalSelection, { unavailableReason: "A qualified worker is required" }));
  assert.equal(inputValue(h.render(), "rentalInspectionModulesJson"), "[]");
  h.update({ busy: true }); tree = h.render(); libraryIn(tree).props.onSelect(formOption(piesaSelection));
  assert.equal(inputValue(h.render(), "attachVeuElectricalAssessment"), "false");
  h.update({ busy: false }); tree = h.render();
  for (let index = 1; index < 21; index++) { libraryIn(tree).props.onSelect(formOption(businessSelection(`scope-${index}`))); tree = h.render(); }
  assert.equal(JSON.parse(inputValue(tree, "formSelectionsJson")).length, 20);
  assert.match(text(tree), /Select up to 20 business forms/);
});

test("Creditex premises variants are required and are placed only in the canonical activity selection", async () => {
  const h = wizard({}, { "@/lib/trade-compliance-intent": { activityRequiresPremisesVariant: () => true, activityPremisesVariantId: (_activity, buildingType) => buildingType === "house_townhouse" ? "residential_variant" : "" } });
  let tree = await openForms(h);
  libraryIn(tree).props.onSelect(formOption(creditexSelection)); tree = h.render();
  assert.equal(inputValue(tree, "complianceActivitiesJson"), "[]"); assert.match(text(tree), /Choose the building type/);
  nodes(tree, node => node.type === "select" && node.props.name === "buildingType")[0].props.onChange({ target: { value: "house_townhouse" } }); tree = h.render();
  libraryIn(tree).props.onSelect(formOption(creditexSelection)); tree = h.render();
  assert.deepEqual(JSON.parse(inputValue(tree, "complianceActivitiesJson")), [{ programTemplateId: programme.templateId, activityTemplateId: activity.templateId, variantId: "residential_variant" }]);
  assert.equal(inputValue(tree, "formSelectionsJson"), "[]");
});

test("Add form closes an unfinished activity draft instead of showing the abstract selector beside the library", async () => {
  const h = wizard(); let tree = await openForms(h);
  button(tree, "Close form library").props.onClick(); tree = h.render();
  nodes(tree, node => typeof node.type === "function" && node.type.name === "AddressFields")[0].props.onChange({ addressLine1: "1 Test Road", suburb: "Melbourne", addressState: "VIC", postcode: "3000" }); tree = h.render();
  button(tree, "Add activity").props.onClick(); tree = h.render();
  assert.match(text(tree), /Add a controlled activity/);
  button(tree, "Add form").props.onClick(); tree = h.render();
  assert.doesNotMatch(text(tree), /Add a controlled activity/); assert.ok(libraryIn(tree));
});

function savedPanel({ respond, onChanged, ...initial } = {}) {
  const requests = []; let changes = 0, h;
  const result = { ok: true, serviceCategory: "assessment", templates: [], forms: [] };
  const fetch = async (url, init) => { requests.push({ url, init }); return respond ? respond(url, init) : Response.json(result); };
  h = harness("TradeJobFormsPanel.tsx", "TradeJobFormsPanel", { user, workOrderId: "saved-job", libraryOpen: false,
    onLibraryOpenChange: open => h.update({ libraryOpen: open }), onChanged: async () => { changes++; await onChanged?.(); }, ...initial }, {
    "./TradeBusinessProvider": { useTradeBusinessFetch: () => fetch, useTradeBusiness: () => ({ ownerUid: "owner" }) },
    "./TradeJobFormLibrary": { TradeJobFormLibrary: "form-library" },
    "@/lib/trade-business-form-design": {}, "@/lib/trade-form-library.mjs": {},
    "./TradeWorkTimeTracking": {}, "./WattzunFormAssistButton": {}, "@/lib/wattzun-form-client": {},
  });
  return { ...h, requests, get changes() { return changes; } };
}

test("saved-job Add form can explicitly open and close the canonical attachment library", async () => {
  const h = savedPanel();
  let tree = await h.settle();
  const details = () => nodes(tree, (node) => node.type === "details")[0];
  assert.equal(details().props.open, false);
  assert.equal(libraryIn(tree), undefined);
  h.update({ libraryOpen: true });
  tree = h.render();
  assert.equal(details().props.open, true);
  const library = libraryIn(tree);
  assert.equal(library.props.workOrderId, "saved-job"); assert.equal(library.props.serviceCategory, "assessment");
  await library.props.onSelect(formOption());
  await tick();
  assert.equal(h.requests[1].url, "/api/trade-job-forms");
  assert.deepEqual(JSON.parse(h.requests[1].init.body), { templateKey: "business-scope", templateVersion: 2, workOrderId: "saved-job" });
  tree = await h.settle();
  assert.match(text(tree), /Form business-scope added to this job/);
  assert.equal(libraryIn(tree).props.refreshKey, 1); assert.equal(h.changes, 1);
  details().props.onToggle({ currentTarget: { open: false } });
  tree = h.render();
  assert.equal(details().props.open, false);
  assert.equal(libraryIn(tree), undefined);
});

test("saved rental and PIESA choices create their actual canonical records", async () => {
  for (const [selection, endpoint, body] of [
    [rentalSelection, "/api/field/job-activities", { kind: "rental", moduleKey: "minimum_standards", expectedRevision: 9, workOrderId: "saved-job" }],
    [piesaSelection, "/api/trade-veu-electrical-assessments", { action: "start", workOrderId: "saved-job" }],
  ]) {
    const h = savedPanel({ libraryOpen: true }); let tree = await h.settle();
    await libraryIn(tree).props.onSelect(formOption(selection), 9); tree = await h.settle();
    assert.equal(h.requests[1].url, endpoint); assert.deepEqual(JSON.parse(h.requests[1].init.body), body);
    assert.match(text(tree), /added to this job/); assert.equal(h.changes, 1);
    assert.equal(libraryIn(tree).props.refreshKey, 1);
  }
});

test("saved Creditex selection attaches with exact revision then opens its actual worker form", async () => {
  const selection = { ...creditexSelection, variantId: "residential_variant" };
  const h = savedPanel({ libraryOpen: true, respond: async (url, init) => Response.json(init?.method === "GET" || url.startsWith("/api/trade-job-forms?")
    ? { ok: true, serviceCategory: "assessment", forms: [] }
    : url.startsWith("/api/trade-activity-forms?") ? { records: [{ intentId: "unrelated", activityTemplateId: "another-activity" }, { intentId: "exact-intent", activityTemplateId: activity.templateId }] }
    : { ok: true }) });
  let tree = await h.settle(); await libraryIn(tree).props.onSelect(formOption(selection), 12); tree = await h.settle();
  assert.deepEqual(h.requests.map(request => request.url), ["/api/trade-job-forms?workOrderId=saved-job", "/api/field/job-activities", "/api/trade-activity-forms?workOrderId=saved-job", "/api/trade-activity-forms"]);
  assert.deepEqual(JSON.parse(h.requests[1].init.body), { kind: "program", programTemplateId: programme.templateId, activityTemplateId: activity.templateId, variantId: "residential_variant", expectedRevision: 12, workOrderId: "saved-job" });
  assert.deepEqual(JSON.parse(h.requests[3].init.body), { action: "open", intentId: "exact-intent", variantId: "residential_variant", workOrderId: "saved-job" });
  assert.match(text(tree), /added to this job/); assert.equal(h.changes, 1);
});

test("saved attachments reject stale, missing, unavailable, read-only and repeated actions without claiming success", async () => {
  const missing = savedPanel({ libraryOpen: true }); let tree = await missing.settle();
  await libraryIn(tree).props.onSelect(formOption(rentalSelection)); tree = missing.render();
  assert.match(text(tree), /Refresh the form library/); assert.equal(missing.requests.length, 1); assert.equal(missing.changes, 0);
  const stale = savedPanel({ libraryOpen: true, respond: async (_url, init) => init.method === "POST" ? Response.json({ error: "The job has changed. Refresh and try again." }, { status: 409 }) : Response.json({ ok: true, forms: [] }) });
  tree = await stale.settle(); await libraryIn(tree).props.onSelect(formOption(rentalSelection), 3); tree = stale.render();
  assert.match(text(tree), /The job has changed/); assert.doesNotMatch(text(tree), /added to this job/); assert.equal(stale.changes, 0);
  const blocked = savedPanel({ libraryOpen: true }); tree = await blocked.settle();
  await libraryIn(tree).props.onSelect(formOption(rentalSelection, { added: true }), 3);
  await libraryIn(tree).props.onSelect(formOption(piesaSelection, { unavailableReason: "Qualified worker required" }), 3);
  assert.equal(blocked.requests.length, 1); assert.equal(blocked.changes, 0);
  blocked.update({ readOnly: true }); tree = await blocked.settle(); assert.equal(libraryIn(tree), undefined); assert.equal(nodes(tree, node => node.type === "details").length, 0);
  let finish;
  const repeated = savedPanel({ libraryOpen: true, respond: async (_url, init) => init.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Response.json({ ok: true, forms: [] }) });
  tree = await repeated.settle(); const select = libraryIn(tree).props.onSelect;
  const pending = select(formOption(piesaSelection)); await tick(); await select(formOption(piesaSelection));
  assert.equal(repeated.requests.filter(request => request.init.method === "POST").length, 1);
  finish(Response.json({ ok: true })); await pending; assert.equal(repeated.changes, 1);
});

test("a committed Creditex activity with a blocked worker form reports the saved activity honestly", async () => {
  const h = savedPanel({ libraryOpen: true, respond: async (url, init) => url === "/api/trade-activity-forms" && init.method === "POST"
    ? Response.json({ error: "The published evidence policy is not ready." }, { status: 409 })
    : url.startsWith("/api/trade-activity-forms?") ? Response.json({ records: [{ intentId: "exact-intent", activityTemplateId: activity.templateId }] })
    : Response.json({ ok: true, serviceCategory: "assessment", forms: [] }) });
  let tree = await h.settle(); await libraryIn(tree).props.onSelect(formOption(creditexSelection), 12); tree = await h.settle();
  assert.match(text(tree), /activity is saved on this job, but its form needs attention.*published evidence policy is not ready/);
  assert.doesNotMatch(text(tree), /added to this job/); assert.equal(h.changes, 1);
  assert.equal(h.requests.filter(request => request.url === "/api/field/job-activities").length, 1);
});

test("saved attachment success survives a failed workspace refresh without offering a duplicate mutation", async () => {
  const h = savedPanel({ libraryOpen: true, onChanged: async () => { throw new Error("Network unavailable"); } });
  let tree = await h.settle(); await libraryIn(tree).props.onSelect(formOption()); tree = await h.settle();
  assert.match(text(tree), /added to this job.*latest job details could not be refreshed/);
  assert.equal(h.requests.filter(request => request.init.method === "POST").length, 1); assert.equal(h.changes, 1);
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
