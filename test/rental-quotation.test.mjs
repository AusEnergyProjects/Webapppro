import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as quotationModule from "../src/lib/rental-quotation.mjs";
import * as assessmentModule from "../src/lib/trade-rental-assessment.mjs";
import * as workflowModule from "../src/lib/rental-assessor-workflow.mjs";
import { RENTAL_QUOTATION_FIELDS, RENTAL_OBSERVATION_NUMBER_FIELDS, rentalQuotation, rentalObservationBlockers, rentalObservationFields, rentalAssessorFields, rentalFindingDescriptionLabel, rentalObservationGroup, rentalSharedObservationResponse, rentalObservationResponseLabel } from "../src/lib/rental-quotation.mjs";
import { rentalAssessmentTemplateSnapshot, rentalAssessmentCompletion, rentalCheckIsReadiness, rentalRegimeAssessment } from "../src/lib/trade-rental-assessment.mjs";

const quotation = { status: "ready", measurements: "6 x 4 m = 24 m2, tape measured", specification: "R5 to bare area", access: "Hallway hatch; electrical clearance before work", exclusions: "Electrical rectification separately quoted" };
const finding = () => ({ title: "Insulate bare ceiling area", description: "Bare area above rear bedroom", tradeCategory: "Insulation installer", scopeSummary: "Install suitable R5 insulation to the measured area after clearance", quantityMilli: 24000, unitLabel: "m2", details: { quotation: { ...quotation } } });

test("older shower answers cannot hide uncaptured WELS and flow fields", () => {
  const target = { moduleId: "one", checkKey: "shower_2027_readiness", instanceKey: "property", locationLabel: "Property" };
  const candidate = { ...target, checkKey: "showerhead_rating", outcome: "meets", response: { model: "Recorded model" } };
  const old = rentalSharedObservationResponse({ target, candidates: [candidate] });
  assert.ok(!old.recordedKeys.includes("welsRating"));
  assert.ok(!old.recordedKeys.includes("flowLitresPerMinute"));
  candidate.response = { model: "Recorded model", welsRating: "3 stars", flowLitresPerMinute: 0 };
  const recorded = rentalSharedObservationResponse({ target, candidates: [candidate] });
  assert.equal(recorded.response.welsRating, "3 stars");
  assert.equal(recorded.response.flowLitresPerMinute, 0);
});

test("covering and window-seal measurements are only prompted when work is needed", () => {
  for (const key of ["window_covering", "windows_2027_readiness"]) {
    const fields = rentalAssessorFields({ key });
    const measurements = fields.filter((field) => field.input === "number");
    assert.equal(measurements.length, 1, "Only the dwelling total is needed");
    assert.ok(!fields.some(field => ['widthMm', 'heightMm'].includes(field.key)));
    assert.ok(measurements.every((field) => field.showForOutcomes?.join() === "does_not_meet"));
    assert.deepEqual(rentalObservationBlockers({ checkKey: key, outcome: "meets", response: {}, finding: {} }), []);
    assert.ok(rentalObservationBlockers({ checkKey: key, outcome: "does_not_meet", response: {}, finding: {} }).length);
    assert.deepEqual(rentalObservationBlockers({ checkKey: key, outcome: "does_not_meet", response: { [measurements[0].key]: "12" }, finding: {} }), []);
  }
});

test("a working oven has no measurement prompts; replacement dimensions refer only to the cabinet", () => {
  const fields = rentalAssessorFields({ key: "oven_function" });
  const visible = (outcome) => fields.filter((field) => !field.legacy && (!field.showForOutcomes || field.showForOutcomes.includes(outcome)));
  assert.equal(visible("meets").filter((field) => field.input === "number").length, 0);
  const measurements = visible("does_not_meet").filter((field) => field.input === "number");
  assert.equal(measurements.length, 3);
  assert.ok(measurements.every((field) => field.label.startsWith("Cabinet opening") && !field.required && !field.requiredForAdverse));
  assert.ok(fields.filter((field) => ["widthMm", "heightMm", "depthMm"].includes(field.key)).every((field) => field.legacy));
  assert.equal(rentalObservationResponseLabel("cabinetWidthMm"), "Cabinet opening width (mm)");
});

test("historical quotation details and limitations remain readable without becoming assessor requirements", () => {
  const legacy = rentalQuotation({ exclusions: "Disposal included", missingInformation: "Concealed framing was not visible" });
  assert.match(legacy.exclusions, /Concealed framing was not visible/);
  assert.equal(Object.hasOwn(legacy, "status"), false);
  assert.deepEqual(rentalQuotation(legacy), legacy, "Legacy limitations are preserved once without duplication");
  const longLegacy = rentalQuotation({ exclusions: "A".repeat(4000), missingInformation: "B".repeat(4000) });
  assert.ok(longLegacy.exclusions.endsWith("B".repeat(4000)));
  assert.ok(longLegacy.exclusions.length <= RENTAL_QUOTATION_FIELDS.find((field) => field.key === "exclusions").maxLength);
});

test("server completion accepts evidence-only findings and retains photo and observation requirements", () => {
  const moduleTemplate = { key: "minimum_standards", sections: [{ key: "windows", title: "Window sealing", checks: [{ key: "seals", required: true, requiredEvidenceCount: 1, repeatBy: "property" }] }] };
  const item = { id: "seals", itemKey: "seals", sectionKey: "windows", checkKey: "seals", instanceKey: "property", outcome: "does_not_meet" };
  const input = { moduleTemplate, items: [item], findings: [{ itemId: "seals", title: "Window observation", description: "Visible gap at bedroom window", quantityMilli: 0, unitLabel: "", scopeSummary: "", details: {} }], evidenceCounts: { seals: 2 }, photoCounts: { seals: 2 } };
  for (const templateVersion of [1, 2, 3]) {
    input.moduleTemplate.templateVersion = templateVersion;
    const result = rentalAssessmentCompletion(input);
    assert.equal(result.complete, true, JSON.stringify(result.blockers));
    assert.equal(rentalAssessmentCompletion({ ...input, photoCounts: {} }).complete, false, "Documents cannot replace location/detail photos");
    assert.equal(rentalAssessmentCompletion({ ...input, findings: [{ ...input.findings[0], description: "" }] }).complete, false);
  }
  for (const outcome of ["specialist_verification_required", "not_accessible", "exemption_evidence_pending"]) {
    input.items[0].outcome = outcome;
    assert.equal(rentalAssessmentCompletion(input).complete, true, `${outcome} does not require a trade scope or quantity`);
    assert.equal(input.items[0].outcome, outcome, "Completion never changes the recorded assessment result");
  }
});

test("measurable upgrade observations need basic measurements or an honest access limitation", () => {
  for (const checkKey of ["ceiling_2027_readiness", "windows_2027_readiness", "doors_2027_readiness", "shower_2027_readiness", "cooling_2027_readiness"]) {
    const input = { checkKey, outcome: "does_not_meet", response: {}, finding: { details: {} }, photoCount: 2 };
    assert.match(rentalObservationBlockers(input).join(" "), /basic measurements/, checkKey);
    assert.deepEqual(rentalObservationBlockers({ ...input, response: { measurement: "Bedroom, 4 x 3 metres, tape measured" } }), []);
    assert.deepEqual(rentalObservationBlockers({ ...input, response: { limitationReason: "Hatch was locked and could not be opened safely" } }), []);
    assert.deepEqual(rentalObservationBlockers({ ...input, finding: finding() }), [], "Existing recorded measurements remain usable");
    assert.deepEqual(rentalObservationBlockers({ ...input, outcome: "specialist_verification_required" }), []);
    assert.deepEqual(rentalObservationBlockers({ ...input, response: { measurement: "Bedroom 4 x 3 m" }, photoCount: 0 }), [], "Shared assessment completion enforces the outcome-specific photo policy");
  }
  const moduleTemplate = { key: "minimum_standards", sections: [{ key: "insulation", title: "Insulation", checks: [{ key: "ceiling_2027_readiness", required: true, repeatBy: "property", requiredEvidenceCount: 1 }] }] };
  const input = { moduleTemplate, items: [{ id: "ceiling", itemKey: "ceiling", sectionKey: "insulation", checkKey: "ceiling_2027_readiness", instanceKey: "property", outcome: "does_not_meet", responseJson: {} }], findings: [{ itemId: "ceiling", title: "Bare ceiling", description: "No insulation above rear bedroom" }], evidenceCounts: { ceiling: 2 }, photoCounts: { ceiling: 2 } };
  assert.equal(rentalAssessmentCompletion(input).complete, false);
  input.items[0].responseJson.measurement = "Rear bedroom, 12 m2 bare area from 4 m x 3 m room dimensions";
  assert.equal(rentalAssessmentCompletion(input).complete, true);
});

test("electrical referral has no trade-writing wall and cannot bypass licensed verification", () => {
  const source = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const check = source.sections.find((section) => section.key === "electrical_safety").checks.find((entry) => entry.key === "outlet_lighting_protection");
  const input = { moduleTemplate: { key: source.key, credentialGate: source.credentialGate, sections: [{ key: "electrical_safety", title: "Electrical safety", checks: [check] }] }, items: [{ id: "board", itemKey: "board", sectionKey: "electrical_safety", checkKey: check.key, instanceKey: "property", outcome: "specialist_verification_required", responseJson: {} }], findings: [{ itemId: "board", title: "Electrical observation", description: "Hallway board photographed. Circuit protection needs an electrician to check.", quantityMilli: 0, details: {} }], evidenceCounts: { board: 2 }, photoCounts: { board: 2 } };
  assert.deepEqual(rentalAssessorFields(check), []);
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  input.items[0].outcome = "meets";
  assert.match(rentalAssessmentCompletion(input).blockers.map((blocker) => blocker.label).join(" "), /specialist credential/);
  const testCheck = { key: "rcd_testing", responseType: "test_result", responseFields: [{ key: "testResult", label: "Measured result", required: true }] };
  assert.deepEqual(rentalAssessorFields(testCheck), testCheck.responseFields.map((field) => ({ ...field, input: "textarea" })));
  input.moduleTemplate.sections[0].checks = [{ ...testCheck, required: true, repeatBy: "property", credentialGate: "licensed_electrician" }];
  input.items[0].checkKey = "rcd_testing";
  input.items[0].responseJson = { credentialVerified: true, credentialNumber: "REC-123" };
  assert.match(rentalAssessmentCompletion(input).blockers.map((blocker) => blocker.label).join(" "), /Measured result is required/);
});

test("new full assessments preserve all 15 current categories and distinguish eight future checks", () => {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]);
  const checks = template.modules.minimum_standards.sections.flatMap((section) => section.checks);
  assert.equal(checks.length, 32);
  assert.equal(checks.filter((check) => rentalCheckIsReadiness(check, template.assessmentScope)).length, 8);
  assert.equal(checks.filter((check) => !rentalCheckIsReadiness(check, template.assessmentScope)).length, 24);
  assert.equal(rentalCheckIsReadiness({}, "energy_readiness_2027"), true, "Historical readiness snapshots retain their meaning");
  assert.equal(rentalCheckIsReadiness({ assessmentPhase: "current" }, "energy_readiness_2027"), false);
});

test("practical observation prompts cover safe assessor measurements without inventing design results", () => {
  for (const key of ["cooktop_function", "oven_function", "heating_2027_readiness", "cooling_2027_readiness", "hot_water_2027_readiness", "ceiling_2027_readiness", "doors_2027_readiness", "windows_2027_readiness", "shower_2027_readiness"]) {
    const fields = rentalObservationFields(key);
    assert.ok(fields.some((field) => field.key === "measurement"), key);
    assert.ok(fields.some((field) => field.key === "limitationReason"), key);
    assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  }
  const showerFields = rentalObservationFields("shower_2027_readiness");
  assert.deepEqual(showerFields.filter((field) => field.input === "number").map((field) => [field.key, field.unit]), [["flowLitresPerMinute", "L/min"]]);
  assert.equal(rentalObservationFields("ceiling_2027_readiness").find((field) => field.key === "insulationRating").input, "select");
  assert.equal(rentalObservationFields("switchboard_observation").some((field) => field.key === "measurement"), false);
  assert.match(rentalFindingDescriptionLabel("not_accessible"), /could not be checked/);
  assert.match(rentalFindingDescriptionLabel("specialist_verification_required"), /could you see/);
  const oldCheck = { key: "ceiling_2027_readiness", responseType: "outcome", responseFields: [{ key: "measurement", label: "Target R-value and installation specification", required: false }] };
  assert.doesNotMatch(JSON.stringify(rentalAssessorFields(oldCheck)), /installation specification|target R-value|making good|service route/i);
});

test("structured observations retain explicit units and accept safe measurements without narrative", () => {
  const input = { checkKey: "heating_2027_readiness", outcome: "does_not_meet", photoCount: 2, finding: { details: {} } };
  assert.deepEqual(rentalObservationBlockers({ ...input, response: { roomLengthMetres: "4.2", roomWidthMetres: "3", roomHeightMetres: "2.4" } }), []);
  assert.deepEqual(rentalObservationBlockers({ ...input, response: { limitationStatus: "Unsafe to measure" } }), []);
  assert.ok(rentalObservationBlockers({ ...input, response: { roomLengthMetres: "not a number" } }).length);
  assert.ok(rentalObservationBlockers({ ...input, response: { limitationStatus: "Label unreadable" } }).length, "An unreadable label does not replace room measurements");
  assert.deepEqual(rentalObservationBlockers({ ...input, checkKey: "shower_2027_readiness", response: { flowLitresPerMinute: "0" } }), [], "No flow is a recordable measured value");
  for (const [key, unit] of Object.entries(RENTAL_OBSERVATION_NUMBER_FIELDS)) if (unit) assert.ok(rentalObservationResponseLabel(key).endsWith(`(${unit})`));
  const heater = rentalAssessorFields({ key: "main_living_heater" });
  assert.equal(heater.find((field) => field.key === "applianceType").input, "select");
  assert.ok(heater.find((field) => field.key === "applianceType").options.every((option) => option.value === option.label));
  assert.ok(heater.every((field) => field.input !== "textarea"));
  for (const value of ["", "  ", "0", "4.2", ".5", 0, 2.4]) assert.equal(quotationModule.rentalObservationNumberIsValid(value), true);
  for (const value of ["1e3", "1,000", "-1", "Infinity", true, {}, []]) assert.equal(quotationModule.rentalObservationNumberIsValid(value), false);
});

test("heater identity is captured once, including skipped optional fields, while results remain independent", () => {
  const target = { moduleId: "module", sectionKey: "heating", checkKey: "heating_2027_readiness", instanceKey: "property", locationLabel: "" };
  const source = { ...target, checkKey: "main_living_heater", outcome: "meets", response: { applianceType: "Gas heater", model: "Older readable label text", credentialNumber: "PRIVATE", testResult: "PASS", limitationReason: "Only this check was obstructed", outcome: "meets" } };
  const result = rentalSharedObservationResponse({ target, candidates: [source], currentResponse: { measurement: "Earlier room notes" } });
  assert.equal(rentalObservationGroup(target.checkKey), rentalObservationGroup(source.checkKey));
  assert.deepEqual(result.response, { measurement: "Earlier room notes", applianceType: "Gas heater", model: "Older readable label text" });
  assert.deepEqual(result.recordedKeys, ["applianceType", "model", "serialNumber"]);
  assert.equal(result.sourceCheckKey, "main_living_heater");
  assert.equal(rentalAssessorFields({ key: "heater_efficiency" }).filter((field) => field.shared && !result.recordedKeys.includes(field.key)).length, 0, "Blank optional serial is not asked on every check");
  const blank = rentalSharedObservationResponse({ target, candidates: [{ ...source, response: {} }], currentResponse: {} });
  assert.equal(blank.recordedKeys.length, 3);
  assert.deepEqual(blank.response, {});
  assert.deepEqual(source.response.model, "Older readable label text", "Reading reusable defaults never mutates the source");
});

test("shared defaults refuse other assets, rooms, instances, modules and conflicting equipment", () => {
  const target = { moduleId: "module", sectionKey: "heating", checkKey: "heater_efficiency", instanceKey: "heater-1", locationLabel: "Living room" };
  const source = { ...target, checkKey: "main_living_heater", outcome: "meets", response: { applianceType: "Gas heater", model: "MODEL-A", serialNumber: "SERIAL-A" } };
  for (const changed of [{ moduleId: "other-module" }, { instanceKey: "heater-2" }, { locationLabel: "Bedroom" }, { checkKey: "cooling_2027_readiness" }, { outcome: "not_assessed" }]) {
    assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [{ ...source, ...changed }], currentResponse: {} }).response, {}, JSON.stringify(changed));
  }
  for (const currentResponse of [{ model: "MODEL-B" }, { serialNumber: "SERIAL-B" }, { applianceType: "Split system" }]) {
    assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source], currentResponse }).response, currentResponse);
  }
  assert.deepEqual(rentalSharedObservationResponse({ target: { ...target, locationLabel: "" }, candidates: [{ ...source, locationLabel: "" }], currentResponse: {} }).response, {}, "Unnamed repeatable assets cannot be matched");
  assert.equal(rentalSharedObservationResponse({ target, candidates: [{ ...source, locationLabel: "  LIVING   room " }], currentResponse: {} }).response.model, "MODEL-A");
  const currentResponse = { model: "", actionTaken: "Own observation remains" };
  assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source], currentResponse }).response, { ...currentResponse, applianceType: "Gas heater", serialNumber: "SERIAL-A" }, "An explicitly cleared current field stays cleared");
});

test("latest queued or local shared capture supersedes older saved values without reviving blanks", () => {
  const target = { moduleId: "module", checkKey: "heater_efficiency", instanceKey: "property", locationLabel: "" };
  const source = { ...target, checkKey: "main_living_heater", outcome: "meets", response: { model: "OLD MODEL" } };
  const newer = { ...source, response: { model: "NEW MODEL" } };
  assert.equal(rentalSharedObservationResponse({ target, candidates: [source, newer] }).response.model, "NEW MODEL");
  assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source, { ...newer, response: {} }] }).response, {});
  assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source, { ...newer, outcome: "not_assessed" }] }).recordedKeys, []);
  assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source, { ...newer, locationLabel: "Other room" }] }).response, {}, "A moved latest record must not expose an obsolete location snapshot");
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const showerChecks = template.sections.flatMap((section) => section.checks).filter((check) => ["showerhead_rating", "shower_2027_readiness"].includes(check.key));
  assert.ok(showerChecks.every((check) => check.repeatBy === "property"));
  assert.equal(showerChecks.length, 2);
});

test("web markup uses compact controls and removes already captured equipment fields on later heater checks", async () => {
  const source = (await readFile(new URL("../src/components/TradeRentalInspectionPanel.tsx", import.meta.url), "utf8"))
    .replace("function AssessmentItemCard(", "export function AssessmentItemCard(");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  const dependencies = {
    react: React, "react/jsx-runtime": jsxRuntime,
    "@/lib/rental-quotation.mjs": quotationModule,
    "@/lib/rental-assessor-workflow.mjs": workflowModule,
    "@/lib/trade-rental-assessment.mjs": assessmentModule,
    "./TradeRentalInspectionPanel.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
  };
  new Function("require", "module", "exports", compiled)((id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected web test dependency: ${id}`);
    return dependencies[id];
  }, record, record.exports);
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const section = template.sections.find((entry) => entry.key === "heating");
  const baseItem = { id: "", moduleId: "module", sectionKey: "heating", checkKey: "main_living_heater", instanceKey: "property", locationLabel: "", outcome: "meets", response: {}, revision: 0, publicNotes: "", requiredEvidenceCount: 1 };
  const props = { module: { id: "module", template }, section, item: baseItem, evidence: [], observationCandidates: [], busy: "", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onRegisterDraft() {}, onObservationChange() {} };
  const render = (key, candidates = []) => renderToStaticMarkup(React.createElement(record.exports.AssessmentItemCard, { ...props, check: section.checks.find((entry) => entry.key === key), item: { ...baseItem, checkKey: key }, observationCandidates: candidates }));
  const first = render("main_living_heater");
  assert.match(first, /<select[^>]*name="applianceType"/);
  assert.match(first, /<input[^>]*name="model"/);
  assert.doesNotMatch(first, /<textarea[^>]*name="(?:model|serialNumber)"/);
  const candidates = [{ ...baseItem, id: "saved-heater", response: { applianceType: "Gas heater", model: "Recorded MODEL-42" } }];
  const later = render("heater_efficiency", candidates);
  assert.match(later, /Equipment details already recorded/);
  assert.match(later, /Recorded MODEL-42/);
  assert.doesNotMatch(later, /<(?:input|select|textarea)[^>]*name="(?:model|serialNumber|applianceType)"/);
  const future = render("heating_2027_readiness", candidates);
  assert.match(future, /<input(?=[^>]*type="number")(?=[^>]*name="roomLengthMetres")[^>]*>/);
  assert.match(future, /Room length \(m\)/);
  assert.doesNotMatch(future, /<(?:input|select|textarea)[^>]*name="(?:model|serialNumber|applianceType|measurement)"/);
});

test("completion permits honest limited observations but never infers the applicable rental regime", () => {
  const moduleTemplate = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const section = moduleTemplate.sections[0], check = section.checks[0];
  const item = { id: "one", itemKey: "one", sectionKey: section.key, checkKey: check.key, locationLabel: "Bathroom", outcome: "meets", requiredEvidenceCount: 1 };
  const answers = { inspectionDate: "2026-09-09", dwellingClass: "house", occupancyAtAssessment: "vacant", coverageConfirmed: true, assessorDeclaration: true };
  for (const rentalRegime of ["community_specialised", "rooming_house", "not_sure"]) {
    const result = rentalAssessmentCompletion({ moduleTemplate, items: [item], answers: { ...answers, rentalRegime }, evidenceCounts: { one: 1 } });
    assert.equal(result.complete, true, JSON.stringify(result.blockers));
    assert.equal(rentalRegimeAssessment({ rentalRegime }).applicable, false);
    assert.ok(rentalRegimeAssessment({ rentalRegime }).limitation);
  }
  for (const rentalRegime of ["", "invented", "ordinary_residential"]) assert.equal(rentalAssessmentCompletion({ moduleTemplate, items: [item], answers: { ...answers, rentalRegime }, evidenceCounts: { one: 1 } }).complete, false);
  assert.equal(rentalRegimeAssessment({}).applicable, false);
  assert.equal(rentalAssessmentCompletion({ moduleTemplate, items: [item], answers: { ...answers, rentalRegime: "not_sure" }, evidenceCounts: {} }).complete, true, "Clear ordinary observations no longer require a photo");
  const readiness = rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027").modules.minimum_standards;
  assert.equal(rentalAssessmentCompletion({ moduleTemplate: readiness, items: [item], answers: { ...answers, rentalRegime: "not_sure" }, evidenceCounts: { one: 1 } }).complete, false, "Historical items outside the active scope cannot complete an empty observations report");
});

test("draught quoting uses seal lengths and vent sizes only when relevant", () => {
  const window = rentalObservationFields("windows_2027_readiness");
  assert.deepEqual(window.filter((field) => field.input === "number" && !field.legacy).map((field) => field.key), ["sealLengthMetres"]);
  for (const key of ["doors_2027_readiness", "windows_2027_readiness", "vents_2027_readiness"]) {
    const fields = rentalObservationFields(key);
    assert.equal(new Set(fields.map((field) => field.key)).size, fields.length, "No duplicate location inputs");
    assert.ok(fields.filter((field) => field.input === "number").every((field) => !field.showForOutcomes.includes("meets")));
  }
});
