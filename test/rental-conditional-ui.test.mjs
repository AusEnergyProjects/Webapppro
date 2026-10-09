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

test("web removal targets the selected captured or uploaded photo and disables concurrent evidence actions", async () => {
  const calls = [];
  const evidence = [
    { id: "captured", itemId: "item", fileName: "camera.jpg", contentType: "image/jpeg", sizeBytes: 1000, capture: null },
    { id: "uploaded", itemId: "item", fileName: "gallery.png", contentType: "image/png", sizeBytes: 2000, capture: null },
    { id: "document", itemId: "item", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 3000, capture: null },
  ];
  const h = card("ceiling_2027_readiness", {}, { evidence, onUnlink: async (item, id) => { calls.push([item.id, id]); } });
  const tree = h.render();
  const photos = nodes(tree, node => node.type === "button" && text(node) === "Remove photo");
  assert.equal(photos.length, 2);
  for (const photo of photos) photo.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["item", "captured"], ["item", "uploaded"]]);
  assert.equal(nodes(tree, node => node.type === "button" && text(node) === "Remove file").length, 1);
  const busyTree = h.render({ ...fixtures("ceiling_2027_readiness"), observationCandidates: [], evidence, busy: "unlink:captured", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onObservationChange() {}, onRegisterDraft() {} });
  const removalButtons = nodes(busyTree, node => node.type === "button" && /^(Remove photo|Remove file|Removing\.\.\.)$/.test(text(node)));
  assert.equal(removalButtons.length, 3);
  assert.ok(removalButtons.every(node => node.props.disabled));
  assert.equal(nodes(card("ceiling_2027_readiness", {}, { evidence, readOnly: true }).render(), node => node.type === "button" && /^(Remove photo|Remove file)$/.test(text(node))).length, 0);
});

test("web insulation offers separate camera and gallery pickers through the existing evidence upload", async () => {
  const uploads = [];
  const h = card("ceiling_2027_readiness", {}, { onUpload: async (...args) => { uploads.push(args); } });
  let tree = h.render();
  const camera = input(tree, "cameraPhoto"), gallery = input(tree, "galleryPhoto");
  assert.equal(camera.props.capture, "environment"); assert.equal(gallery.props.capture, undefined);
  assert.equal(camera.props.accept, "image/*"); assert.equal(gallery.props.accept, "image/*");
  const clicks = [];
  camera.props.ref.current = { click() { clicks.push("camera"); } };
  gallery.props.ref.current = { click() { clicks.push("gallery"); } };
  nodes(tree, node => node.type === "button" && text(node) === "Take photo")[0].props.onClick();
  nodes(tree, node => node.type === "button" && text(node) === "Upload from gallery")[0].props.onClick();
  assert.deepEqual(clicks, ["camera", "gallery"]);
  const selected = new File(["photo"], "insulation.jpg", { type: "image/jpeg" });
  const control = { files: [selected], value: "selected" };
  gallery.props.onChange({ currentTarget: control }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads.length, 1); assert.equal(uploads[0][0].id, "item"); assert.equal(uploads[0][1], selected);
  assert.equal(uploads[0][2], fixtures("ceiling_2027_readiness").check.prompt); assert.equal(control.value, "");
  const busy = card("ceiling_2027_readiness", {}, { busy: "upload:item" }); tree = busy.render();
  for (const label of ["Take photo", "Upload from gallery"]) assert.equal(nodes(tree, node => node.type === "button" && text(node) === label)[0].props.disabled, true);
  assert.equal(input(card("cooling_2027_readiness").render(), "galleryPhoto"), undefined);
  assert.equal(input(card("ceiling_2027_readiness", {}, { readOnly: true }).render(), "galleryPhoto"), undefined);
});

test("web changing a limitation hides its old reason without losing the stored value", () => {
  const response = { limitationStatus: "Other", limitationReason: "Plant behind locked door" };
  const h = card("hot_water_2027_readiness", response);
  let tree = h.render(); assert.ok(input(tree, "limitationReason"));
  input(tree, "limitationStatus").props.onChange({ target: { value: "No limitation" } });
  tree = h.render(); assert.equal(input(tree, "limitationReason"), undefined);
  assert.equal(response.limitationReason, "Plant behind locked door");
});

test("web cable branches follow the current status while retired rating answers stay saved without controls", () => {
  const response = { applianceType: "Split system", cableMeasurementStatus: "Measured", airconTotalCableMetres: "18", cableRouteBasis: "Wall route",
    heatingGemsStatus: "Label recorded", heatingEnergyRating: "4 stars", heatingRatingZone: "Cold", heatingRatingBasis: "Appliance label" };
  const h = card("heating_2027_readiness", response);
  let tree = h.render();
  nodes(tree, node => node.type === "button" && text(node) === "Edit equipment details")[0].props.onClick();
  tree = h.render();
  assert.equal(input(tree, "airconTotalCableMetres"), undefined, "An earlier combined run is retained rather than reused as either proposed segment");
  for (const key of ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) assert.ok(input(tree, key));
  for (const suffix of ["GemsStatus", "EnergyRating", "RatingZone", "RatingBasis", "GemsReference", "RatingLimitation"]) assert.equal(input(tree, `heating${suffix}`), undefined);
  input(tree, "cableMeasurementStatus").props.onChange({ target: { value: "Unable to determine" } });
  tree = h.render();
  for (const key of ["airconTotalCableMetres", "airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres", "cableRouteBasis"]) assert.equal(input(tree, key), undefined);
  assert.ok(input(tree, "cableLimitationReason"));
  assert.equal(input(tree, "heatingEnergyRating"), undefined); assert.equal(input(tree, "heatingRatingLimitation"), undefined);
  assert.equal(response.airconTotalCableMetres, "18"); assert.equal(response.heatingEnergyRating, "4 stars");
});

test("the main heater check avoids duplicate RCAC prompts and its saved model does not hide replacement distances", () => {
  const response = { applianceType: "Gas heater", model: "Existing heater model" };
  const h = card("main_living_heater", response);
  let tree = h.render();
  assert.equal(input(tree, "model"), undefined); assert.equal(input(tree, "serialNumber"), undefined, "Existing optional identity blanks retain their previous compact presentation");
  for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres", "cableRouteBasis"]) assert.equal(input(tree, key), undefined);
  const future = card("heating_2027_readiness", response);
  tree = future.render();
  assert.ok(input(tree, "cableMeasurementStatus"), "A model cannot stand in for a measured or estimated cable basis");
  input(tree, "cableMeasurementStatus").props.onChange({ target: { value: "Estimated" } });
  tree = future.render();
  assert.ok(input(tree, "airconSwitchboardToOutdoorMetres")); assert.ok(input(tree, "airconOutdoorToIndoorMetres")); assert.ok(input(tree, "cableRouteBasis"));
  assert.equal(response.cableMeasurementStatus, undefined); assert.equal(response.airconTotalCableMetres, undefined);
});

test("web retains an earlier combined zero run without inventing either missing RCAC segment", () => {
  for (const airconTotalCableMetres of [0, "0"]) {
    const response = { applianceType: "Split system", model: "Recorded heater", cableMeasurementStatus: "Measured", airconTotalCableMetres, cableRouteBasis: "Unit beside switchboard" };
    const h = card("main_living_heater", response); const tree = h.render();
    for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis"]) assert.equal(input(tree, key), undefined);
    assert.equal(h.body().response.airconTotalCableMetres, airconTotalCableMetres);
    const future = card("heating_2027_readiness", { applianceType: "Split system", model: "Recorded heater" }, { observationCandidates: [{ ...fixtures("main_living_heater", response).item, id: "current-heater" }] });
    const futureTree = future.render();
    for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis"]) assert.equal(input(futureTree, key), undefined);
    for (const key of ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) {
      assert.ok(input(futureTree, key)); assert.equal(future.body().response[key], "", "An unanswered segment stays blank in the form body");
    }
    assert.equal(future.body().response.airconTotalCableMetres, airconTotalCableMetres);
  }
  const partial = card("heating_2027_readiness", { model: "Existing model", cableMeasurementStatus: "Measured", airconSwitchboardToOutdoorMetres: "0", cableRouteBasis: "Outdoor unit beside board" });
  const tree = partial.render();
  assert.equal(input(tree, "airconSwitchboardToOutdoorMetres"), undefined);
  assert.ok(input(tree, "airconOutdoorToIndoorMetres"), "A saved first segment does not hide an uncaptured second segment");
});

test("web asks each proposed RCAC distance once across heating checks, including gas replacement and no existing heater", () => {
  for (const applianceType of ["Gas heater", "No heater"]) {
    const trees = ["main_living_heater", "heater_operation", "heater_efficiency", "heating_2027_readiness"].map(key =>
      card(key, { applianceType, cableMeasurementStatus: "Estimated" }).render());
    for (const [key, label] of [
      ["airconSwitchboardToOutdoorMetres", "Estimated cable run from the switchboard to the proposed outdoor RCAC unit"],
      ["airconOutdoorToIndoorMetres", "Estimated distance from the proposed outdoor RCAC unit to the indoor unit"],
    ]) {
      const controls = trees.flatMap(tree => nodes(tree, node => node.props?.name === key));
      assert.equal(controls.length, 1, `${applianceType}: ${key}`);
      assert.equal(controls[0].props.type, "number"); assert.equal(controls[0].props.min, 0);
      assert.match(text(trees[3]), new RegExp(label));
      assert.match(text(trees[3]), /\(m\)/);
    }
  }
});

test("web reuses the recorded indoor RCAC segment and retains old totals when saving a corrected segment", () => {
  const response = { applianceType: "Gas heater", cableMeasurementStatus: "Estimated", airconTotalCableMetres: "22",
    airconSwitchboardToOutdoorMetres: "14.5", airconOutdoorToIndoorMetres: "7.5", cableRouteBasis: "Proposed outdoor location and indoor wall route" };
  const h = card("heating_2027_readiness", response);
  let tree = h.render();
  for (const key of ["airconTotalCableMetres", "airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) assert.equal(input(tree, key), undefined);
  assert.equal(h.body().response.airconOutdoorToIndoorMetres, "7.5");
  nodes(tree, node => node.type === "button" && text(node) === "Edit equipment details")[0].props.onClick();
  tree = h.render();
  assert.equal(input(tree, "airconTotalCableMetres"), undefined);
  input(tree, "airconOutdoorToIndoorMetres").props.onChange({ target: { value: "8.25" } });
  tree = h.render();
  const form = nodes(tree, node => node.type === "form")[0];
  form.props.ref.current.values.set("airconOutdoorToIndoorMetres", "8.25");
  assert.equal(h.body().response.airconOutdoorToIndoorMetres, "8.25");
  assert.equal(h.body().response.airconTotalCableMetres, "22");
  assert.equal(response.airconOutdoorToIndoorMetres, "7.5", "Saved input fixture remains unchanged");
});

test("web heater and cooling saves preserve old ratings and accept appliances without rating answers", () => {
  for (const [checkKey, mode] of [["heater_efficiency", "heating"], ["heating_2027_readiness", "heating"], ["cooling_2027_readiness", "cooling"]]) {
    for (const rating of [{}, { [`${mode}GemsStatus`]: "Label recorded", [`${mode}EnergyRating`]: "4 stars", [`${mode}RatingZone`]: "Cold", [`${mode}RatingBasis`]: "Appliance label", [`${mode}GemsReference`]: "Recorded model" }]) {
      const cable = checkKey === "heater_efficiency" ? {} : { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed route; electrician to confirm" };
      const response = { applianceType: "Split system", ...cable, ...rating };
      const h = card(checkKey, response);
      const tree = h.render();
      for (const suffix of ["GemsStatus", "EnergyRating", "RatingZone", "RatingBasis", "GemsReference", "RatingLimitation"]) assert.equal(input(tree, `${mode}${suffix}`), undefined);
      const saved = h.body();
      assert.equal(saved.outcome, "meets");
      for (const [key, value] of Object.entries(rating)) assert.equal(saved.response[key], value);
      assert.deepEqual(response, { applianceType: "Split system", ...cable, ...rating });
    }
  }
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

test("web confirms non-IC4 count without a free-text evidence question and preserves any earlier text", () => {
  for (const downlightEvidence of [undefined, "Visual"]) {
    const response = { downlightCountStatus: "Counted", nonIc4DownlightCount: "7", ...(downlightEvidence ? { downlightEvidence } : {}) };
    const h = card("artificial_lighting", response);
    const tree = h.render();
    assert.equal(input(tree, "downlightEvidence"), undefined);
    assert.ok(input(tree, "downlightCountStatus")); assert.ok(input(tree, "nonIc4DownlightCount"));
    const saved = h.body(); assert.equal(saved.response.nonIc4DownlightCount, "7");
    if (downlightEvidence) assert.equal(saved.response.downlightEvidence, downlightEvidence);
    assert.deepEqual(response, { downlightCountStatus: "Counted", nonIc4DownlightCount: "7", ...(downlightEvidence ? { downlightEvidence } : {}) });
  }
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
  assert.equal(nodes(tree, node => Boolean(node.props?.name))[0].props.name, 'homeStarCommissioned');
  assert.match(text(tree), /Is this assessment commissioned by Home Star Upgrades\?/);
  const definition = assessmentModule.template.metadataFields.find(field => field.key === 'homeStarCommissioned');
  assert.equal(definition.required, false); assert.equal(definition.phase, 'setup');
  const form = nodes(tree, node => node.type === 'form')[0];
  await form.props.onSubmit({ preventDefault() {}, currentTarget: form.props.ref.current }); assert.equal(saved, undefined, 'Opening and saving untouched optional settings does not enable a brand');
  form.props.ref.current.values.set('homeStarCommissioned', 'on');
  await form.props.onSubmit({ preventDefault() {}, currentTarget: form.props.ref.current }); assert.deepEqual(saved, { homeStarCommissioned: true });
});

test('web puts an existing Home Star field first without inserting it into earlier snapshots or clearing a saved decision', () => {
  const assessmentModule = fixtures('artificial_lighting').module;
  const reversed = { ...assessmentModule, answers: { homeStarCommissioned: true }, template: { ...assessmentModule.template, metadataFields: [...assessmentModule.template.metadataFields].reverse() } };
  const baseline = JSON.stringify(reversed);
  const h = mount('MetadataForm', { module: reversed, busy: false, readOnly: false, onSave: async () => {} });
  const tree = h.render(); const controls = nodes(tree, node => Boolean(node.props?.name));
  assert.equal(controls[0].props.name, 'homeStarCommissioned'); assert.equal(controls[0].props.defaultChecked, true);
  assert.equal(JSON.stringify(reversed), baseline);
  const old = { ...assessmentModule, template: { ...assessmentModule.template, metadataFields: assessmentModule.template.metadataFields.filter(field => field.key !== 'homeStarCommissioned') } };
  const legacy = mount('MetadataForm', { module: old, busy: false, readOnly: false, onSave: async () => {} });
  assert.equal(input(legacy.render(), 'homeStarCommissioned'), undefined);
});

test('web shared building hot water updates wording and photo guidance immediately from the selected answers', () => {
  const h = card('hot_water_2027_readiness', { hotWaterSupplyType: 'Individual unit' });
  let tree = h.render(); assert.doesNotMatch(text(tree), /Is hot water supplied to this apartment\?/);
  input(tree, 'hotWaterSupplyType').props.onChange({ target: { value: 'Shared building system' } });
  tree = h.render(); assert.match(text(tree), /Is hot water supplied to this apartment\?/);
  assert.match(text(tree), /Hot water supplied; shared plant not inspected/);
  assert.match(text(tree), /apartment tap or shower/); assert.doesNotMatch(text(tree), /complete system data plate/);
  input(tree, 'sharedHotWaterServiceStatus').props.onChange({ target: { value: 'Hot water supplied when checked' } });
  tree = h.render(); assert.match(text(tree), /Hot water supplied; shared plant not inspected/);
  assert.equal(input(tree, 'limitationStatus'), undefined); assert.equal(input(tree, 'limitationReason'), undefined);
  assert.ok(input(tree, 'sharedHotWaterLimitation'));
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
