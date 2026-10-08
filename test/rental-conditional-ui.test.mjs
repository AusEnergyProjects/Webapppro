import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as quotation from "../src/lib/rental-quotation.mjs";
import * as assessment from "../src/lib/trade-rental-assessment.mjs";
import * as workflow from "../src/lib/rental-assessor-workflow.mjs";

const source = readFileSync(new URL("../src/components/TradeRentalInspectionPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/function (MetadataForm|AssessmentItemCard)\(/g, "export function $1("), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const element = (type, props) => ({ type, props });
const nodes = (node, predicate) => node == null || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const template = assessment.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
function fixtures(checkKey, response = {}, outcome = "meets", version = 4) {
  const section = template.sections.find(entry => entry.checks.some(check => check.key === checkKey));
  const check = section.checks.find(entry => entry.key === checkKey);
  const assessmentModule = { id: "module", key: "minimum_standards", template: { ...template, templateVersion: version }, answers: {}, revision: 9, status: "draft" };
  const item = { id: "item", moduleId: assessmentModule.id, sectionKey: section.key, checkKey, instanceKey: "property", locationLabel: "Property", response,
    outcome, publicNotes: "", internalNotes: "", revision: 2, sortOrder: 0 };
  return { module: assessmentModule, section, check, item };
}

function mount(name, props) {
  const state = [], effects = [], pending = [];
  let cursor = 0;
  const changed = (previous, next) => !previous || !next || previous.length !== next.length || previous.some((value, index) => value !== next[index]);
  const react = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return state[index] ||= { current: initial }; },
    useMemo(callback, dependencies) { const index = cursor++; if (!state[index] || changed(state[index].dependencies, dependencies)) state[index] = { dependencies, value: callback() }; return state[index].value; },
    useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) { const index = cursor++; if (!effects[index] || changed(effects[index].dependencies, dependencies)) {
      const old = effects[index]; effects[index] = { dependencies }; pending.push(() => { old?.cleanup?.(); effects[index].cleanup = callback(); }); } },
  };
  class FormData {
    constructor(form) { this.values = new Map([...form.values].filter(([key]) => !form.disabledNames?.has(key))); }
    has(key) { return this.values.has(key); }
    get(key) { return this.values.get(key) ?? null; }
  }
  const dependencies = { react, "react/jsx-runtime": { jsx: element, jsxs: element }, "./TradeBusinessProvider": { useTradeBusinessFetch: () => null },
    "@/lib/rental-quotation.mjs": quotation, "@/lib/trade-rental-assessment.mjs": assessment, "@/lib/rental-assessor-workflow.mjs": workflow,
    "./TradeWorkTimeTracking": { useFormTimeTracking: () => ({ bind: {}, markCompleted() {} }), WorkTimeStatus: () => null },
    "./TradeRentalInspectionPanel.module.css": { default: {} } };
  const output = { exports: {} };
  new Function("require", "module", "exports", "FormData", compiled)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, output, output.exports, FormData);
  const render = (nextProps = props) => {
    props = nextProps; cursor = 0;
    const tree = output.exports[name](props);
    for (const form of nodes(tree, node => node.type === "form" && node.props.ref)) {
      if (!form.props.ref.current) {
        const values = new Map();
        for (const control of nodes(form, node => node.props?.name)) {
          const { name, type, checked, defaultChecked, value, defaultValue } = control.props;
          if ((type === "checkbox" || type === "radio") && !(checked ?? defaultChecked)) continue;
          values.set(name, value ?? defaultValue ?? "");
        }
        form.props.ref.current = { values, reportValidity: () => true };
      }
      form.props.ref.current.disabledNames = new Set(nodes(form, node => node.props?.name && node.props.disabled).map(node => node.props.name));
    }
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  return { render, unmount() { for (const effect of effects) effect?.cleanup?.(); } };
}
function card(checkKey, response, extra = {}) {
  let provider;
  const h = mount("AssessmentItemCard", { ...fixtures(checkKey, response), observationCandidates: [], evidence: [], busy: "", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onObservationChange() {}, onRegisterDraft(_key, callback) { provider = callback; }, ...extra });
  return { ...h, body: () => provider().body };
}
const input = (tree, name) => nodes(tree, node => node.props?.name === name)[0];

test("web changing a limitation hides its old reason without losing the stored value", () => {
  const response = { limitationStatus: "Other", limitationReason: "Plant behind locked door" };
  const h = card("hot_water_2027_readiness", response);
  let tree = h.render(); assert.ok(input(tree, "limitationReason"));
  input(tree, "limitationStatus").props.onChange({ target: { value: "No limitation" } });
  tree = h.render(); assert.equal(input(tree, "limitationReason"), undefined);
  assert.equal(response.limitationReason, "Plant behind locked door");
});

test("web cable and rating branches follow the current status despite retained earlier answers", () => {
  const response = { applianceType: "Split system", cableMeasurementStatus: "Measured", airconTotalCableMetres: "18", cableRouteBasis: "Wall route",
    heatingGemsStatus: "Label recorded", heatingEnergyRating: "4 stars", heatingRatingZone: "Cold", heatingRatingBasis: "Appliance label" };
  const h = card("heating_2027_readiness", response);
  let tree = h.render(); assert.ok(input(tree, "airconTotalCableMetres")); assert.ok(input(tree, "heatingEnergyRating"));
  input(tree, "cableMeasurementStatus").props.onChange({ target: { value: "Unable to determine" } });
  input(tree, "heatingGemsStatus").props.onChange({ target: { value: "Unverified" } });
  tree = h.render();
  assert.equal(input(tree, "airconTotalCableMetres"), undefined); assert.equal(input(tree, "cableRouteBasis"), undefined);
  assert.ok(input(tree, "cableLimitationReason")); assert.equal(input(tree, "heatingEnergyRating"), undefined); assert.ok(input(tree, "heatingRatingLimitation"));
  assert.equal(response.airconTotalCableMetres, "18"); assert.equal(response.heatingEnergyRating, "4 stars");
});

test("web save ignores inactive invalid numeric history but still rejects an active invalid measurement", () => {
  const h = card("cooktop_function", { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed route", cooktopCableRunMetres: "4..2" });
  h.render(); const saved = h.body(); assert.equal(saved.response.cooktopCableRunMetres, "4..2");
  const invalid = card("cooktop_function", { cableMeasurementStatus: "Measured", cableRouteBasis: "Observed route", cooktopCableRunMetres: "4..2" });
  invalid.render(); assert.throws(invalid.body, /valid number/);
});

test("web v4 saves require the logical current quoting answer while v3 snapshots keep prior requirements", () => {
  const h = card("artificial_lighting", {}); h.render(); assert.throws(h.body, /non-IC4 downlight count/);
  const legacy = card("artificial_lighting", {}, { module: fixtures("artificial_lighting", {}, "meets", 3).module });
  const tree = legacy.render(); assert.equal(input(tree, "downlightCountStatus"), undefined); assert.equal(legacy.body().outcome, "meets");
});

test("correcting the web outcome removes required photo requests and retains attached evidence", () => {
  const retained = { id: "photo", itemId: "item", fileName: "overview.jpg", contentType: "image/jpeg", sizeBytes: 120 };
  const h = card("mould_damp_observation", {}, { item: fixtures("mould_damp_observation", {}, "does_not_meet").item, evidence: [retained] });
  let tree = h.render(); assert.match(text(tree), /required photo/);
  const clear = nodes(tree, node => node.props?.name === "outcome" && node.props.value === "meets")[0]; clear.props.onChange();
  tree = h.render(); assert.doesNotMatch(text(tree), /required photo/); assert.match(text(tree), /optional file/); assert.match(text(tree), /overview.jpg/);
});

test("web unsaved metadata is tracked until genuinely saved or reverted and is disabled during upgrade", () => {
  let dirty;
  const assessmentModule = fixtures("artificial_lighting").module;
  const props = { module: assessmentModule, busy: false, readOnly: false, onSave: async () => {}, onDirtyChange: (_key, value) => { dirty = value; } };
  const h = mount("MetadataForm", props); let tree = h.render(); assert.equal(dirty, false);
  const form = nodes(tree, node => node.type === "form")[0];
  form.props.ref.current.values.set("homeStarCommissioned", "on"); form.props.onChange({ currentTarget: form.props.ref.current }); assert.equal(dirty, true);
  tree = h.render({ ...props, busy: true });
  assert.ok(nodes(tree, node => node.props?.name).every(node => node.props.disabled));
  const savedProps = { ...props, busy: true, module: { ...assessmentModule, answers: { homeStarCommissioned: true } } };
  tree = h.render(savedProps); assert.equal(dirty, true, 'Disabled controls are omitted from FormData; keep real dirty state until enabled');
  tree = h.render({ ...savedProps, busy: false }); assert.equal(dirty, false);
  const current = nodes(tree, node => node.type === "form")[0]; current.props.ref.current.values.delete("homeStarCommissioned");
  current.props.onChange({ currentTarget: current.props.ref.current }); assert.equal(dirty, true);
  current.props.ref.current.values.set("homeStarCommissioned", "on"); current.props.onChange({ currentTarget: current.props.ref.current }); assert.equal(dirty, false);
  h.unmount(); assert.equal(dirty, false);
});

test("HomeStar branding is an optional web choice, starts off and persists only the deliberate checkbox change", async () => {
  let saved;
  const assessmentModule = fixtures('artificial_lighting').module;
  const h = mount('MetadataForm', { module: assessmentModule, busy: false, readOnly: false, onSave: async answers => { saved = answers; } });
  const tree = h.render(); const checkbox = input(tree, 'homeStarCommissioned');
  assert.ok(checkbox); assert.equal(checkbox.props.type, 'checkbox'); assert.equal(checkbox.props.defaultChecked, false); assert.equal(checkbox.props.required, undefined);
  const definition = assessmentModule.template.metadataFields.find(field => field.key === 'homeStarCommissioned');
  assert.equal(definition.required, false); assert.equal(definition.phase, 'setup');
  const form = nodes(tree, node => node.type === 'form')[0];
  await form.props.onSubmit({ preventDefault() {}, currentTarget: form.props.ref.current }); assert.equal(saved, undefined, 'Opening and saving untouched optional settings does not enable a brand');
  form.props.ref.current.values.set('homeStarCommissioned', 'on');
  await form.props.onSubmit({ preventDefault() {}, currentTarget: form.props.ref.current }); assert.deepEqual(saved, { homeStarCommissioned: true });
});

test("web working cooling asks for canonical operating evidence and shows the actual guidance", () => {
  const h = card("cooling_2027_readiness", {}); const tree = h.render();
  assert.match(text(tree), /2\s+required photo/); assert.match(text(tree), /controller|operating (?:indicator|light)/i);
});

test("v4 web switchboard is two results and required photo without an extra mandatory note", () => {
  for (const outcome of ["meets", "does_not_meet"]) {
    const h = card("outlet_lighting_protection", {}, { item: fixtures("outlet_lighting_protection", {}, outcome).item });
    const tree = h.render();
    assert.deepEqual(nodes(tree, node => node.props?.name === "outcome").map(node => node.props.value), ["meets", "does_not_meet"]);
    assert.equal(input(tree, "publicNotes").props.required, false);
    assert.equal(input(tree, "severity"), undefined); assert.equal(input(tree, "credentialNumber"), undefined);
    assert.equal(nodes(tree, node => node.props?.name && node.props.name !== "outcome" && node.props.required).length, 1, 'Only the file upload is required after an answer');
    assert.match(text(tree), /1\s+required photo/);
    const body = h.body(); assert.equal(body.outcome, outcome); assert.equal(body.finding, undefined);
  }
  const oldDefinition = { ...fixtures("outlet_lighting_protection").check, verificationBasis: undefined, credentialGate: "licensed_electrician" };
  const legacy = card("outlet_lighting_protection", {}, { check: oldDefinition, module: fixtures("outlet_lighting_protection", {}, "does_not_meet", 3).module,
    item: fixtures("outlet_lighting_protection", {}, "does_not_meet").item });
  const tree = legacy.render(); assert.equal(input(tree, "publicNotes").props.required, true); assert.ok(input(tree, "severity"));
});

test("web updates old questions only on an explicit clean revision checked action", async () => {
  const ast = ts.createSourceFile('TradeRentalInspectionPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let branch;
  function visit(node) { if (ts.isBinaryExpression(node) && node.getText(ast).startsWith('canEdit && !latestReport') && node.getText(ast).includes('Update assessment questions')) branch = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(branch);
  const code = ts.transpileModule(`export function render() { return ${branch.getText(ast)}; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const env = { canEdit: true, latestReport: undefined, activeModule: fixtures('artificial_lighting', {}, 'meets', 3).module,
    data: { inspection: { revision: 12 } }, dirtyItems: new Set(), dirtyMetadata: new Set(), busy: '', styles: {},
    RENTAL_ASSESSMENT_TEMPLATE_VERSION: assessment.RENTAL_ASSESSMENT_TEMPLATE_VERSION,
    mutate: async body => { env.sent = body; } };
  const render = new Function('environment', 'require', `with(environment){const exports={};${code};return exports.render;}`)(env,
    id => { assert.equal(id, 'react/jsx-runtime'); return { jsx: element, jsxs: element }; });
  const button = () => nodes(render(), node => node.type === 'button')[0];
  assert.equal(button().props.disabled, false); assert.match(text(button()), /Update assessment questions/);
  await button().props.onClick(); assert.deepEqual(env.sent, { action: 'set_assessment_scope', moduleId: 'module', scope: 'current_minimum_standards', expectedInspectionRevision: 12, expectedModuleRevision: 9 });
  env.dirtyMetadata.add('module:setup'); assert.equal(button().props.disabled, true); env.dirtyMetadata.clear();
  env.dirtyItems.add('item'); assert.equal(button().props.disabled, true); env.dirtyItems.clear();
  env.busy = 'scope'; assert.equal(button().props.disabled, true); env.busy = '';
  env.activeModule.template.templateVersion = assessment.RENTAL_ASSESSMENT_TEMPLATE_VERSION; assert.equal(button(), undefined);
});
