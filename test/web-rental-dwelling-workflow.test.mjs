import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as quotation from "../src/lib/rental-quotation.mjs";
import * as assessment from "../src/lib/trade-rental-assessment.mjs";
import * as workflowHelpers from "../src/lib/rental-assessor-workflow.mjs";

const source = readFileSync(new URL("../src/components/TradeRentalInspectionPanel.tsx", import.meta.url), "utf8");
const exposed = source.replace(/function (assessmentGroups|groupItems|earlierObservationItems|blockerSection|initialItem|metadataAnswerPatch|MetadataForm|AssessmentItemCard)\(/g, "export function $1(");
const compiled = ts.transpileModule(exposed, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const output = { exports: {} };
const dependencies = {
  react: React, "react/jsx-runtime": jsxRuntime,
  "@/lib/rental-quotation.mjs": quotation,
  "@/lib/trade-rental-assessment.mjs": assessment,
  "@/lib/rental-assessor-workflow.mjs": workflowHelpers,
  "./TradeRentalInspectionPanel.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
};
new Function("require", "module", "exports", compiled)((id) => {
  assert.ok(id in dependencies, `Unexpected dependency ${id}`);
  return dependencies[id];
}, output, output.exports);
const { assessmentGroups, groupItems, earlierObservationItems, blockerSection, initialItem, metadataAnswerPatch, MetadataForm, AssessmentItemCard } = output.exports;
const template = assessment.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
const assessmentModule = (extra = {}) => ({
  id: "module", key: "minimum_standards", template, answers: {}, revision: 1, status: "draft", ...extra,
});
const entryFor = (checkKey) => {
  const section = template.sections.find((section) => section.checks.some((check) => check.key === checkKey));
  return { section, check: section.checks.find((check) => check.key === checkKey) };
};
const item = (checkKey, extra = {}) => {
  const { section, check } = entryFor(checkKey);
  return { ...initialItem(assessmentModule(), section, check), id: `saved-${checkKey}`, itemKey: `item-${checkKey}`, outcome: "meets", revision: 1, ...extra };
};
function renderCard(checkKey, extra = {}, cardProps = {}) {
  const { section, check } = entryFor(checkKey);
  return renderToStaticMarkup(React.createElement(AssessmentItemCard, {
    module: assessmentModule(), section, check, item: item(checkKey, extra),
    evidence: [], observationCandidates: [], busy: "", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onRegisterDraft() {}, onObservationChange() {}, ...cardProps,
  }));
}

test("the dwelling walkthrough exposes every check once without requiring any room setup", () => {
  for (const answers of [{}, { roomRoster: [{ id: "old-room", label: "Bedroom 1", type: "bedroom" }] }]) {
    const workflow = assessmentGroups(assessmentModule({ answers }));
    const actual = workflow.groups.flatMap((group) => group.entries.map(({ check }) => check.key));
    assert.deepEqual(actual, template.sections.flatMap((section) => section.checks.map((check) => check.key)).filter((key) => key !== "shower_2027_readiness"));
    assert.ok(actual.includes("showerhead_rating"));
    assert.equal(new Set(actual).size, actual.length);
    assert.ok(workflow.groups.every((group) => group.dwelling));
    assert.ok(!Object.hasOwn(workflow, "rooms"));
  }
  assert.doesNotMatch(source, /RoomRosterForm|roomWindowsGroup|rentalRoomChecks|Add room|Add another window|roomRosterUnconfirmed/);
});

test("one shower rating and flow control replaces the repeated outcome and rating questions", () => {
  const markup = renderCard("showerhead_rating", { id: "", response: { welsRating: "3 stars", flowLitresPerMinute: "8" } });
  assert.equal((markup.match(/name="showerChoice"/g) || []).length, 6);
  assert.equal((markup.match(/name="flowLitresPerMinute"/g) || []).length, 1);
  assert.doesNotMatch(markup, /name="outcome"|name="welsRating"|name="serialNumber"/);
  assert.match(markup, /checked="" value="3 stars"/);
  const unknown = renderCard("showerhead_rating", { outcome: "specialist_verification_required", response: { welsRating: "Not labelled / unknown" } });
  assert.match(unknown, /checked="" value="Not labelled \/ unknown"/);
});

test("retired shower observations and their evidence stay reachable under the main shower", () => {
  const legacy = item("shower_2027_readiness", { itemKey: "legacy-shower", response: { welsRating: "3 stars" } });
  const current = item("showerhead_rating");
  const { section, check } = entryFor("showerhead_rating");
  const earlier = earlierObservationItems(assessmentModule(), section, check, [current, legacy]);
  assert.deepEqual(earlier.map(({ item }) => item.id), [legacy.id]);
  assert.equal(earlier[0].check.key, "shower_2027_readiness");
  const markup = renderCard(earlier[0].check.key, legacy, { historical: true, readOnly: true, evidence: [{ id: "photo-1", itemId: legacy.id, fileName: "existing-shower.jpg", contentType: "image/jpeg", sizeBytes: 1024, capture: null }] });
  assert.match(markup, /Earlier observation|existing-shower.jpg/);
  assert.doesNotMatch(markup, /Save changes|Remove link/);
  const groups = assessmentGroups(assessmentModule()).groups;
  for (const key of ["check:showers:shower_2027_readiness", "evidence:legacy-shower", "response:legacy-shower:flowLitresPerMinute"]) {
    assert.equal(blockerSection({ key }, groups, [legacy]), section.key);
  }
  assert.equal(legacy.response.welsRating, "3 stars");
});

test("a historical room result cannot supply a dwelling answer, while an existing property record is reused", () => {
  const old = item("mould_damp_observation", { id: "room-result", instanceKey: "bedroom-1", locationLabel: "Bedroom 1" });
  const other = item("mould_damp_observation", { id: "other-result", instanceKey: "bathroom-1", locationLabel: "Bathroom 1", outcome: "does_not_meet" });
  const whole = item("mould_damp_observation", { id: "property-result" });
  const { section, check } = entryFor("mould_damp_observation");
  const group = assessmentGroups(assessmentModule()).groups.find((group) => group.key === section.key);
  assert.deepEqual(groupItems(group, section, check, [old, other]), []);
  assert.deepEqual(groupItems(group, section, check, [old, whole, other]).map((entry) => entry.id), [whole.id]);
  assert.equal(old.locationLabel, "Bedroom 1");
  assert.equal(other.outcome, "does_not_meet");
  const earlier = renderCard(check.key, other, { historical: true, readOnly: true });
  assert.match(earlier, /Earlier observation: Bathroom 1/);
  assert.match(earlier, /<fieldset[^>]*disabled/);
  assert.doesNotMatch(earlier, /Save changes|Remove link|Exact location/);
});

test("every frozen repeated minimum-standard check starts as one property answer with no location input", () => {
  for (const checkKey of ["toilet_function", "artificial_lighting", "mould_damp_observation", "room_ventilation", "window_operation_security", "window_covering", "windows_2027_readiness"]) {
    const { section, check } = entryFor(checkKey);
    const frozen = { ...check, repeatBy: "room" };
    assert.equal(initialItem(assessmentModule(), section, frozen).instanceKey, "property");
    assert.equal(initialItem(assessmentModule(), section, frozen).locationLabel, "Property");
    const markup = renderCard(checkKey);
    assert.match(markup, /type="hidden" name="locationLabel" value="Property"/);
    assert.doesNotMatch(markup, /Exact location|Room use|Add another window/);
  }
});

test("new and frozen profile/date questions stay out of property details and final declarations", () => {
  const metadataFields = [
    { key: "inspectionDate", type: "date", label: "Assessment date" },
    { key: "assessorName", type: "text", label: "Assessor name" },
    { key: "qualificationType", type: "text", label: "Assessor qualification" },
    { key: "qualificationNumber", type: "text", label: "Licence number" },
    { key: "rentalAgreementStartDate", type: "date", label: "Agreement start, if known" },
    { key: "coverageConfirmed", type: "checkbox", label: "Old repeatable entries declaration" },
    { key: "credentialConfirmed", type: "checkbox", label: "Old credential confirmation" },
    { key: "assessorDeclaration", type: "checkbox", label: "My observations are accurate" },
  ].map((field) => ({ required: false, help: "", placeholder: "", options: [], ...field }));
  const frozenModule = assessmentModule({ template: { ...template, metadataFields } });
  const render = (phase) => renderToStaticMarkup(React.createElement(MetadataForm, { module: frozenModule, phase, busy: false, readOnly: false, onSave() {} }));
  for (const phase of ["setup", "final"]) assert.doesNotMatch(render(phase), /name="(?:inspectionDate|assessorName|qualificationType|qualificationNumber|credentialConfirmed)"/);
  assert.match(render("setup"), /name="rentalAgreementStartDate"/);
  assert.doesNotMatch(render("setup"), /name="assessorDeclaration"|name="coverageConfirmed"/);
  assert.match(render("final"), /I have checked the property and recorded any areas I could not access/);
  assert.match(render("final"), /name="assessorDeclaration"/);
  assert.doesNotMatch(render("final"), /name="rentalAgreementStartDate"|Old repeatable entries declaration/);
});

test("saving one metadata phase sends only changed fields and never echoes an earlier final declaration", () => {
  const fields = [{ key: "rentalAgreementStartDate", type: "date" }];
  const previous = { rentalAgreementStartDate: "2026-01-01", assessorDeclaration: true, coverageConfirmed: true, inspectionDate: "2026-09-09", qualificationNumber: "PROFILE-1" };
  const values = new FormData();
  values.set("rentalAgreementStartDate", "2026-07-01");
  assert.deepEqual(metadataAnswerPatch(fields, values, previous), { rentalAgreementStartDate: "2026-07-01" });
  values.set("rentalAgreementStartDate", previous.rentalAgreementStartDate);
  assert.deepEqual(metadataAnswerPatch(fields, values, previous), {});
  assert.deepEqual(metadataAnswerPatch([{ key: "assessorDeclaration", type: "checkbox" }], new FormData(), previous), { assessorDeclaration: false });
});

test("completion problems link to the actual check category, including evidence and saved answer failures", () => {
  const groups = assessmentGroups(assessmentModule()).groups;
  const saved = item("artificial_lighting");
  assert.equal(blockerSection({ key: "check:lighting:artificial_lighting" }, groups, []), "lighting");
  for (const key of [`outcome:${saved.itemKey}`, `evidence:${saved.itemKey}`, `response:${saved.itemKey}:measurement`]) {
    assert.equal(blockerSection({ key }, groups, [saved]), "lighting");
  }
  assert.equal(blockerSection({ key: "metadata:assessorDeclaration" }, groups, [saved]), undefined);
  assert.match(source, /moduleCompletion\.blockers\.map/);
  assert.doesNotMatch(source, /blockers\.slice\(0, 12\)/);
});

test("clear mould and damage checks do not demand a photo but observed problems require overview and detail", () => {
  for (const checkKey of ["mould_damp_observation", "structure_weatherproofing"]) {
    assert.match(renderCard(checkKey), /Photos are optional for this answer/);
    assert.doesNotMatch(renderCard(checkKey), /of [12] required/);
    assert.match(renderCard(checkKey, { outcome: "does_not_meet" }), /0 of 2 required photos/);
    assert.doesNotMatch(renderCard(checkKey, { outcome: "not_accessible" }), /of 2 required photos/);
  }
});

test("existing door and window seals and a present wall vent need photo proof", () => {
  for (const checkKey of ["doors_2027_readiness", "windows_2027_readiness", "vents_2027_readiness"]) {
    const markup = renderCard(checkKey);
    assert.match(markup, /What to photograph/);
    assert.match(markup, /0 of 1 required photo/);
    assert.doesNotMatch(markup, /Photos are optional for this answer/);
  }
  assert.match(renderCard("vents_2027_readiness", { outcome: "not_applicable", publicNotes: "No wall vents were observed during the assessment." }), /Photos are optional for this answer/);
});

test("draughtproofing asks for totals and hides old width and height inputs while retaining saved data", () => {
  const response = { widthMm: "2400", heightMm: "1200", sealLengthMetres: "7.2" };
  const markup = renderCard("windows_2027_readiness", { response, outcome: "does_not_meet" });
  assert.match(markup, /name="sealLengthMetres"/);
  assert.doesNotMatch(markup, /name="widthMm"|name="heightMm"/);
  assert.equal(response.widthMm, "2400");
  assert.doesNotMatch(renderCard("windows_2027_readiness", { response }), /name="sealLengthMetres"/);
});

test("minimum-standard specialist credentials come from Team rather than per-job text inputs", () => {
  const markup = renderCard("outlet_lighting_protection");
  assert.doesNotMatch(markup, /name="credentialType"|name="credentialNumber"|name="credentialVerified"/);
});

test("existing property equipment details are reused even when the earlier property label was blank", () => {
  const previous = item("main_living_heater", { locationLabel: "", response: { applianceType: "Gas heater", model: "HEATER-42" } });
  const markup = renderCard("heating_2027_readiness", {}, { observationCandidates: [previous] });
  assert.match(markup, /Equipment details already recorded/);
  assert.match(markup, /HEATER-42/);
  assert.doesNotMatch(markup, /<(?:input|select)[^>]*name="(?:model|applianceType)"/);
});

test("historical narrow and separately licensed modules retain their real template sections", () => {
  for (const [key, scope] of [["minimum_standards", "energy_readiness_2027"], ["electrical_safety_check", undefined]]) {
    const actualTemplate = assessment.rentalAssessmentTemplateSnapshot([key], scope).modules[key];
    const workflow = assessmentGroups(assessmentModule({ key, template: actualTemplate }));
    assert.deepEqual(workflow.groups.flatMap((group) => group.entries.map(({ check }) => check.key)), actualTemplate.sections.flatMap((section) => section.checks.map((check) => check.key)));
  }
});
