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

test("version four adds default-off HomeStar setup and quote capture through explicit template adoption", () => {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  assert.equal(template.templateVersion, 4);
  const commissioning = template.metadataFields.find((entry) => entry.key === "homeStarCommissioned");
  assert.equal(commissioning.type, "checkbox");
  assert.equal(commissioning.phase, "setup");
  assert.equal(commissioning.required, false);
  for (const checkKey of ["main_living_heater", "heating_2027_readiness", "cooktop_function", "hot_water_2027_readiness", "artificial_lighting"]) {
    const old = rentalAssessorFields({ key: checkKey }, { templateVersion: 3 });
    const current = rentalAssessorFields({ key: checkKey }, { templateVersion: 4 });
    const cableKeys = ["cableMeasurementStatus", "hotWaterCableRunMetres", "airconTotalCableMetres", "airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres", "cooktopCableRunMetres", "cableRouteBasis", "cableLimitationReason"];
    assert.ok(old.filter((entry) => entry.captureVersion === 4).every((entry) => cableKeys.includes(entry.key)), "Only quoting cable controls become available in earlier active editors");
    assert.ok(current.some((entry) => entry.captureVersion === 4));
    assert.deepEqual(rentalObservationBlockers({ checkKey, outcome: "meets", response: {}, enforceQuoteCapture: false }), [], "Earlier snapshots retain their completion contract");
  }
  assert.ok(rentalAssessorFields({ key: "ceiling_2027_readiness" }, { templateVersion: 3 }).some((entry) => entry.key === "joistClearWidthMm"));
});

test("appliance cable capture records metres and route even for working equipment", () => {
  for (const [checkKey, lengthKey, appliance, reportLabel] of [["hot_water_2027_readiness", "hotWaterCableRunMetres", "hot-water system", "Hot-water system to switchboard cable run"], ["cooktop_function", "cooktopCableRunMetres", "cooktop", "Cooktop to switchboard cable run"]]) {
    const fields = rentalObservationFields(checkKey);
    assert.match(rentalObservationBlockers({ checkKey, outcome: "meets", response: {}, enforceQuoteCapture: true }).join(" "), /cable length was measured/, "Version-four quoting capture does not skip working appliances");
    assert.match(rentalObservationBlockers({ checkKey, outcome: "does_not_meet", response: { measurement: "Existing installation photographed" }, enforceQuoteCapture: true }).join(" "), /cable length was measured/);
    assert.equal(fields.find((entry) => entry.key === lengthKey).unit, "m");
    assert.equal(fields.find((entry) => entry.key === lengthKey).label, `How far is the cable run from the ${appliance} to the switchboard?`);
    assert.equal(fields.find((entry) => entry.key === "cableMeasurementStatus").label, `Can you measure or estimate the cable run from the ${appliance} to the switchboard?`);
    assert.equal(fields.find((entry) => entry.key === "cableRouteBasis").label, "Where would the cable run?");
    assert.equal(rentalObservationResponseLabel(lengthKey), `${reportLabel} (m)`);
    const response = { cableMeasurementStatus: "Measured", [lengthKey]: "12.5", cableRouteBasis: "Switchboard through accessible roof route, including a 2m drop" };
    assert.ok(fields.filter((entry) => entry.key === lengthKey || entry.key === "cableRouteBasis").every((entry) => quotationModule.rentalObservationFieldIsVisible(entry, { outcome: "meets", response })));
    for (const cableMeasurementStatus of ["Measured", "Estimated"]) {
      assert.deepEqual(rentalObservationBlockers({ checkKey, outcome: "meets", response: { ...response, cableMeasurementStatus }, enforceQuoteCapture: true }), []);
      assert.match(rentalObservationBlockers({ checkKey, outcome: "meets", response: { ...response, cableMeasurementStatus, cableRouteBasis: "" }, enforceQuoteCapture: true }).join(" "), /route/);
    }
    assert.deepEqual(rentalObservationBlockers({ checkKey, outcome: "meets", response: { cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Concealed route inaccessible" }, enforceQuoteCapture: true }), []);
    assert.match(rentalObservationBlockers({ checkKey, outcome: "meets", response: { cableMeasurementStatus: "Unable to determine" }, enforceQuoteCapture: true }).join(" "), /why/);
  }
});

test("RCAC quoting captures two distinct proposed installation segments once, including when the existing heater is gas", () => {
  const fields = rentalObservationFields("heating_2027_readiness");
  const labels = {
    airconSwitchboardToOutdoorMetres: "Estimated cable run from the switchboard to the proposed outdoor RCAC unit",
    airconOutdoorToIndoorMetres: "Estimated distance from the proposed outdoor RCAC unit to the indoor unit",
  };
  for (const [key, label] of Object.entries(labels)) {
    const field = fields.find((entry) => entry.key === key);
    assert.equal(field.input, "number");
    assert.equal(field.unit, "m");
    assert.equal(field.label, label);
    assert.equal(field.captureVersion, 4);
    assert.equal(field.shared, true);
    assert.notEqual(field.required, true);
    assert.ok(Object.hasOwn(RENTAL_OBSERVATION_NUMBER_FIELDS, key));
  }
  assert.equal(fields.find((entry) => entry.key === "airconTotalCableMetres").legacy, true);
  assert.equal(rentalObservationResponseLabel("airconTotalCableMetres"), "Earlier combined RCAC cable run (m)");
  const main = rentalObservationFields("main_living_heater");
  for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis", "cableLimitationReason"]) {
    const field = main.find((entry) => entry.key === key);
    assert.equal(field.legacy, true, `${key} remains recorded but does not ask the quotation question again`);
    assert.equal(field.shared, true);
  }
  assert.ok(!main.some((field) => Object.hasOwn(labels, field.key) && !field.legacy));
  assert.deepEqual(rentalObservationBlockers({ checkKey: "main_living_heater", outcome: "meets", response: { applianceType: "Gas heater" }, enforceQuoteCapture: true }), []);
  for (const cableMeasurementStatus of ["Measured", "Estimated"]) {
    const response = { applianceType: "Gas heater", cableMeasurementStatus, airconSwitchboardToOutdoorMetres: "15.2", airconOutdoorToIndoorMetres: "6.4", cableRouteBasis: "Switchboard via roof to proposed outdoor position; indoor unit on living room wall" };
    for (const key of Object.keys(labels)) assert.equal(quotationModule.rentalObservationFieldIsVisible(fields.find((field) => field.key === key), { outcome: "meets", response }), true);
    assert.deepEqual(rentalObservationBlockers({ checkKey: "heating_2027_readiness", outcome: "meets", response, enforceQuoteCapture: true }), []);
    assert.deepEqual(rentalObservationBlockers({ checkKey: "heating_2027_readiness", outcome: "meets", response: { ...response, airconOutdoorToIndoorMetres: "" }, enforceQuoteCapture: true }), [], "An unrecorded second segment does not retroactively block completion");
    assert.match(rentalObservationBlockers({ checkKey: "heating_2027_readiness", outcome: "meets", response: { ...response, airconSwitchboardToOutdoorMetres: "" }, enforceQuoteCapture: true }).join(" "), /cable|length|distance/i);
    const old = { applianceType: "Gas heater", cableMeasurementStatus, airconTotalCableMetres: "22.5", cableRouteBasis: "Earlier combined route" };
    assert.deepEqual(rentalObservationBlockers({ checkKey: "heating_2027_readiness", outcome: "meets", response: old, enforceQuoteCapture: true }), [], "A prior complete quotation remains complete without inventing segment lengths");
    const projected = quotationModule.rentalObservationResponseProjection("heating_2027_readiness", "meets", old);
    assert.equal(projected.response.airconTotalCableMetres, "22.5");
    assert.equal(Object.hasOwn(projected.response, "airconSwitchboardToOutdoorMetres"), false);
    assert.equal(Object.hasOwn(projected.response, "airconOutdoorToIndoorMetres"), false);
  }
});

test("working gas and non-gas appliances require quoting capture without guessing the cooktop fuel", () => {
  for (const [checkKey, types] of [["hot_water_2027_readiness", ["Gas storage", "Instant gas", "Heat pump", "Electric storage", "Unknown"]], ["heating_2027_readiness", ["Gas heater", "Split system", "Unknown"]], ["cooktop_function", [undefined]]]) {
    for (const applianceType of types) {
      const response = applianceType ? { applianceType } : {};
      assert.match(rentalObservationBlockers({ checkKey, outcome: "meets", response, enforceQuoteCapture: true }).join(" "), /cable length was measured/);
      for (const outcome of ["not_assessed", "not_applicable"]) assert.deepEqual(rentalObservationBlockers({ checkKey, outcome, response, enforceQuoteCapture: true }), []);
    }
  }
  assert.ok(!rentalObservationFields("cooktop_function").some(field => field.key === "applianceType"), "No new fuel assumption or question is introduced");
});

test("older active editors show all cable controls without changing their frozen templates or requiring new answers", () => {
  const frozen = { key: "minimum_standards", templateVersion: 3, metadataFields: [], sections: [{ key: "kitchen", checks: [{ key: "cooktop_function", required: true, repeatBy: "property", requiredEvidenceCount: 0, responseFields: [] }] }] };
  const before = structuredClone(frozen);
  for (const version of [1, 2, 3, 4]) for (const [checkKey, lengthKeys] of [["cooktop_function", ["cooktopCableRunMetres"]], ["hot_water_2027_readiness", ["hotWaterCableRunMetres"]], ["heating_2027_readiness", ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]]]) {
    const controls = rentalAssessorFields({ key: checkKey }, { templateVersion: version });
    assert.ok(["cableMeasurementStatus", ...lengthKeys, "cableRouteBasis", "cableLimitationReason"].every(key => controls.some(field => field.key === key && !field.legacy)), `${checkKey} v${version}`);
    assert.deepEqual(rentalObservationBlockers({ checkKey, outcome: "meets", response: {}, enforceQuoteCapture: false }), []);
  }
  for (const version of [1, 2, 3, 4]) assert.ok(rentalAssessorFields({ key: "main_living_heater" }, { templateVersion: version }).filter((field) => field.key.startsWith("aircon") || field.key.startsWith("cable")).every((field) => field.legacy), `The v${version} main-heater editor does not repeat quoting controls`);
  const result = rentalAssessmentCompletion({ moduleTemplate: frozen, items: [{ id: "cooktop", checkKey: "cooktop_function", sectionKey: "kitchen", instanceKey: "property", outcome: "meets", responseJson: "{}" }], answers: {} });
  assert.equal(result.complete, true, JSON.stringify(result.blockers));
  assert.deepEqual(frozen, before, "Rendering current controls and checking completion do not rewrite an earlier frozen template");
});

test("both RCAC quotation segments accept safe decimal distances and reject invalid measurements", () => {
  for (const key of ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) {
    for (const value of ["", "0", 0, "15.2", 15.2, ".5"]) assert.equal(quotationModule.rentalObservationNumberIsValid(value, key), true, `${key}: ${JSON.stringify(value)}`);
    for (const value of ["-1", -1, "1e3", "1,000", "Infinity", Infinity, true, {}, []]) assert.equal(quotationModule.rentalObservationNumberIsValid(value, key), false, `${key}: ${JSON.stringify(value)}`);
  }
});

test("non-IC4 counts are actual whole counts and unknown status does not infer zero", () => {
  const input = { checkKey: "artificial_lighting", outcome: "meets", enforceQuoteCapture: true };
  for (const nonIc4DownlightCount of [0, "0", 7, "7", String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(quotationModule.rentalObservationNumberIsValid(nonIc4DownlightCount, "nonIc4DownlightCount"), true);
    assert.deepEqual(rentalObservationBlockers({ ...input, response: { downlightCountStatus: "Counted", nonIc4DownlightCount } }), [], "A confirmed count does not need an extra free-text evidence answer");
    assert.deepEqual(rentalObservationBlockers({ ...input, response: { downlightCountStatus: "Counted", nonIc4DownlightCount, downlightEvidence: "Readable non-IC4 labels; photo references recorded" } }), []);
  }
  for (const value of [-1, "-1", 1.5, "1.0", "1e3", "1,000", Number.MAX_SAFE_INTEGER + 1, true, {}, []]) assert.equal(quotationModule.rentalObservationNumberIsValid(value, "nonIc4DownlightCount"), false, JSON.stringify(value));
  assert.match(rentalObservationBlockers({ ...input, response: { downlightCountStatus: "Counted", downlightEvidence: "Labels" } }).join(" "), /whole.*count/);
  for (const downlightCountStatus of ["Unknown", "Unverified"]) {
    const response = { downlightCountStatus, downlightCountLimitation: "Labels could not be read safely", nonIc4DownlightCount: "7", downlightEvidence: "Earlier count" };
    assert.deepEqual(rentalObservationBlockers({ ...input, response }), []);
    const projection = quotationModule.rentalObservationResponseProjection(input.checkKey, input.outcome, response);
    assert.equal(Object.hasOwn(projection.response, "nonIc4DownlightCount"), false);
    assert.equal(projection.retainedResponse.nonIc4DownlightCount, "7");
    assert.equal(response.nonIc4DownlightCount, "7", "Earlier data is retained without being an active count");
  }
  assert.deepEqual(rentalObservationBlockers({ ...input, response: { downlightCountStatus: "No downlights" } }), []);
});

test("downlight evidence text is retired while count controls and the existing photo guidance remain", () => {
  const fields = rentalAssessorFields({ key: "artificial_lighting" }, { templateVersion: 4 });
  assert.equal(fields.find((field) => field.key === "downlightEvidence").legacy, true);
  assert.ok(fields.filter((field) => !field.legacy).some((field) => field.key === "downlightCountStatus"));
  assert.ok(fields.filter((field) => !field.legacy).some((field) => field.key === "nonIc4DownlightCount"));
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const check = template.sections.flatMap((section) => section.checks).find((check) => check.key === "artificial_lighting");
  assert.match(check.photoGuidance, /light off.*on/);
  assert.ok(workflowModule.rentalAssessorEvidenceRequirement(check, "does_not_meet").minimumPhotos > 0);
});

test("correcting a conditional selection hides inactive answers without deleting them or using them to complete", () => {
  const response = { limitationStatus: "No limitation", limitationReason: "Earlier roof inaccessible", cableMeasurementStatus: "Unable to determine", cooktopCableRunMetres: "not-current", cableRouteBasis: "Earlier route", cableLimitationReason: "Current concealed route" };
  const fields = rentalObservationFields("cooktop_function");
  assert.equal(quotationModule.rentalObservationFieldIsVisible(fields.find((field) => field.key === "limitationReason"), { outcome: "meets", response }), false);
  assert.equal(quotationModule.rentalObservationFieldIsVisible(fields.find((field) => field.key === "cooktopCableRunMetres"), { outcome: "meets", response }), false);
  assert.deepEqual(rentalObservationBlockers({ checkKey: "cooktop_function", outcome: "meets", response, enforceQuoteCapture: true }), []);
  const projection = quotationModule.rentalObservationResponseProjection("cooktop_function", "meets", response);
  assert.equal(projection.retainedResponse.limitationReason, response.limitationReason);
  assert.equal(projection.retainedResponse.cooktopCableRunMetres, "not-current");
  assert.equal(projection.response.cableLimitationReason, "Current concealed route");
});

test("heating and cooling rating questions are retired from the shared web and native assessor controls", () => {
  for (const [checkKey, mode] of [["heater_efficiency", "heating"], ["heating_2027_readiness", "heating"], ["cooling_2027_readiness", "cooling"]]) {
    const ratingKeys = ["GemsStatus", "EnergyRating", "RatingZone", "RatingBasis", "GemsReference", "RatingLimitation"].map((suffix) => `${mode}${suffix}`);
    const retired = rentalObservationFields(checkKey).filter((field) => ratingKeys.includes(field.key));
    assert.deepEqual(retired.map((field) => field.key).sort(), [...ratingKeys].sort());
    assert.ok(retired.every((field) => field.legacy));
    for (const templateVersion of [1, 2, 3, 4]) {
      const activeFields = rentalAssessorFields({ key: checkKey }, { templateVersion }).filter((field) => !field.legacy);
      assert.ok(activeFields.every((field) => !ratingKeys.includes(field.key)), `${checkKey} v${templateVersion}`);
    }
  }
});

test("rating status, stars, climate zone, evidence and unavailable reason no longer block save or completion", () => {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  for (const [checkKey, mode] of [["heater_efficiency", "heating"], ["heating_2027_readiness", "heating"], ["cooling_2027_readiness", "cooling"]]) {
    const response = { applianceType: "Split system", roomLengthMetres: "4", cableMeasurementStatus: "Unable to determine", cableLimitationReason: "Route concealed" };
    const input = { checkKey, outcome: "meets", enforceQuoteCapture: true };
    const section = template.sections.find((entry) => entry.checks.some((check) => check.key === checkKey));
    const check = section.checks.find((entry) => entry.key === checkKey);
    const moduleTemplate = { ...template, sections: [{ ...section, checks: [check] }] };
    const item = { id: checkKey, itemKey: checkKey, instanceKey: "property", sectionKey: section.key, checkKey, outcome: "meets" };
    const answers = { inspectionDate: "2026-10-08", dwellingClass: "house", occupancyAtAssessment: "vacant", rentalRegime: "ordinary_residential", agreementStartDate: "2026-10-01", coverageConfirmed: true, assessorDeclaration: true };
    for (const status of [undefined, "Label recorded", "Not available", "Unreadable", "Unverified", "Not applicable"]) {
      const partialRating = { ...response, ...(status === undefined ? {} : { [`${mode}GemsStatus`]: status }) };
      for (const outcome of ["meets", "does_not_meet"]) assert.deepEqual(rentalObservationBlockers({ ...input, outcome, response: partialRating }), []);
      const complete = rentalAssessmentCompletion({ moduleTemplate, items: [{ ...item, responseJson: JSON.stringify(partialRating) }], answers,
        evidenceCounts: { [checkKey]: 2 }, photoCounts: { [checkKey]: 2 } });
      assert.equal(complete.complete, true, JSON.stringify(complete.blockers));
    }
  }
  const gas = { applianceType: "Gas heater", heatingGemsStatus: "Label recorded", heatingEnergyRating: "Earlier different appliance" };
  assert.equal(quotationModule.rentalObservationFieldIsVisible(rentalObservationFields("heater_efficiency").find((field) => field.key === "heatingEnergyRating"), { outcome: "meets", response: gas }), false);
  assert.deepEqual(rentalObservationBlockers({ checkKey: "heater_efficiency", outcome: "meets", response: gas, enforceQuoteCapture: true }), []);
});

test("working shared building hot water can complete its apartment supply observation without certifying the unseen plant", () => {
  const response = { hotWaterSupplyType: "Shared building system", sharedHotWaterServiceStatus: "Hot water supplied when checked", sharedHotWaterLimitation: "Building plant not inspected; request building manager information", widthMm: "old", hotWaterCableRunMetres: "old", cableMeasurementStatus: "Measured", limitationStatus: "Other", limitationReason: "Earlier generic limitation" };
  const input = { checkKey: "hot_water_2027_readiness", outcome: "specialist_verification_required", response, enforceQuoteCapture: true };
  assert.deepEqual(rentalObservationBlockers(input), []);
  const projection = quotationModule.rentalObservationResponseProjection(input.checkKey, input.outcome, response);
  assert.equal(Object.hasOwn(projection.response, "hotWaterCableRunMetres"), false);
  assert.equal(projection.retainedResponse.hotWaterCableRunMetres, "old");
  assert.equal(Object.hasOwn(projection.response, "limitationStatus"), false);
  assert.equal(Object.hasOwn(projection.response, "limitationReason"), false);
  assert.equal(projection.retainedResponse.limitationStatus, "Other");
  assert.equal(projection.retainedResponse.limitationReason, "Earlier generic limitation");
  assert.deepEqual(rentalObservationBlockers({ ...input, outcome: "meets" }), []);
  assert.match(rentalObservationBlockers({ ...input, response: { ...response, sharedHotWaterLimitation: "" } }).join(" "), /not inspected/);
  const visible = rentalAssessorFields({ key: input.checkKey }, { templateVersion: 4 }).filter((field) => quotationModule.rentalObservationFieldIsVisible(field, { outcome: "meets", response }));
  for (const key of ["applianceType", "model", "serialNumber", "widthMm", "heightMm", "accessWidthMm", "accessStatus", "cableMeasurementStatus", "hotWaterCableRunMetres", "cableRouteBasis", "limitationStatus", "limitationReason"]) {
    assert.ok(!visible.some((field) => field.key === key), `An inaccessible shared plant does not request ${key}`);
  }
  for (const key of ["hotWaterSupplyType", "sharedHotWaterServiceStatus", "sharedHotWaterLimitation"]) assert.ok(visible.some((field) => field.key === key));
  assert.equal(response.widthMm, "old", "Earlier equipment observations remain untouched but inactive");
  const individualResponse = { ...response, hotWaterSupplyType: "Individual unit" };
  const ordinaryLimits = rentalObservationFields(input.checkKey).filter((field) => ["limitationStatus", "limitationReason"].includes(field.key));
  assert.ok(ordinaryLimits.every((field) => quotationModule.rentalObservationFieldIsVisible(field, { outcome: "meets", response: individualResponse })), "Individual units retain the original limitation controls");
});

test("shared hot-water completion rejects a supplied result when the apartment had no hot water or was not checked", () => {
  const input = { checkKey: "hot_water_2027_readiness", outcome: "meets", enforceQuoteCapture: true };
  const response = { hotWaterSupplyType: "Shared building system", sharedHotWaterLimitation: "Building plant not accessible" };
  for (const [sharedHotWaterServiceStatus, outcome, message] of [["No hot water when checked", "does_not_meet", /needing action/], ["Not checked", "not_accessible", /could not be checked/]]) {
    assert.match(rentalObservationBlockers({ ...input, response: { ...response, sharedHotWaterServiceStatus } }).join(" "), message);
    assert.deepEqual(rentalObservationBlockers({ ...input, outcome, response: { ...response, sharedHotWaterServiceStatus } }), []);
  }
  for (const sharedHotWaterServiceStatus of [undefined, "Assumed supplied", ""]) assert.match(rentalObservationBlockers({ ...input, response: { ...response, sharedHotWaterServiceStatus } }).join(" "), /supply observed/);
  assert.match(rentalObservationBlockers({ ...input, response: { ...response, sharedHotWaterServiceStatus: "Hot water supplied when checked", sharedHotWaterLimitation: " " } }).join(" "), /not inspected/);
});

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
  const check = { ...source.sections.find((section) => section.key === "electrical_safety").checks.find((entry) => entry.key === "outlet_lighting_protection"), credentialGate: "licensed_electrician" };
  delete check.verificationBasis;
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
  assert.equal(checks.length, 31);
  assert.equal(checks.filter((check) => rentalCheckIsReadiness(check, template.assessmentScope)).length, 8);
  assert.equal(checks.filter((check) => !rentalCheckIsReadiness(check, template.assessmentScope)).length, 23);
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

test("ceiling quotations capture a clear joist gap without making a quote measurement mandatory", () => {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const check = template.sections.find((section) => section.key === "ceiling_insulation").checks[0];
  const fields = rentalAssessorFields(check);
  const gap = fields.find((field) => field.key === "joistClearWidthMm");
  assert.equal(gap.label, "Clear gap between ceiling joists");
  assert.equal(gap.unit, "mm");
  assert.equal(gap.required, false);
  assert.equal(gap.requiredForAdverse, false);
  assert.equal(rentalObservationResponseLabel(gap.key), "Clear gap between ceiling joists (mm)");
  assert.deepEqual(fields.find((field) => field.key === "limitationReason").showIf.values, ["Not accessible", "Unsafe to measure", "Other"]);
  assert.deepEqual(rentalAssessorFields({ key: check.key, responseFields: [] }), fields, "Existing drafts expose the new quoting observation without replacing their template");

  const moduleTemplate = { key: "minimum_standards", sections: [{ key: "ceiling_insulation", title: "Ceiling insulation", checks: [{ key: check.key, required: true, repeatBy: "property", requiredEvidenceCount: 1 }] }] };
  const input = { moduleTemplate, items: [{ id: "ceiling", itemKey: "ceiling", sectionKey: "ceiling_insulation", checkKey: check.key, instanceKey: "property", outcome: "does_not_meet", responseJson: { areaSquareMetres: "24" } }], findings: [{ itemId: "ceiling", title: "Bare ceiling", description: "No insulation above rear bedroom" }], evidenceCounts: { ceiling: 2 }, photoCounts: { ceiling: 2 } };
  assert.equal(rentalAssessmentCompletion(input).complete, true, "An existing measured area remains complete without the optional gap");
  input.items[0].responseJson = { joistClearWidthMm: "430" };
  const gapOnly = rentalAssessmentCompletion(input);
  assert.equal(gapOnly.complete, false, "A quote-only joist gap cannot replace the existing insulation-area observation");
  assert.match(gapOnly.blockers.map((blocker) => blocker.label).join(" "), /basic measurements/);
  input.items[0].responseJson = { areaSquareMetres: "24", joistClearWidthMm: "430" };
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  for (const limitationStatus of ["Not accessible", "Unsafe to measure"]) {
    input.items[0].responseJson = { limitationStatus, limitationReason: "No safe access through the locked roof hatch" };
    assert.equal(rentalAssessmentCompletion(input).complete, true, limitationStatus);
    assert.equal(Object.hasOwn(input.items[0].responseJson, "joistClearWidthMm"), false, "No measurement is inferred from the limitation");
  }
  input.items[0].responseJson = { areaSquareMetres: "24", joistClearWidthMm: "430.5" };
  const invalid = rentalAssessmentCompletion(input);
  assert.equal(invalid.complete, false);
  assert.match(invalid.blockers.map((blocker) => blocker.label).join(" "), /whole number between 1 and 5000 mm/);
});

test("joist measurements use whole millimetres within the practical bound and preserve other numeric observations", () => {
  for (const value of [undefined, null, "", "  ", "1", "430", " 5000 ", 1, 430, 5000]) {
    assert.equal(quotationModule.rentalObservationNumberIsValid(value, "joistClearWidthMm"), true, String(value));
  }
  for (const value of [0, "0", -1, "-1", 430.5, "430.5", "430.0", 5001, "5001", "1e3", "1,000", "430 mm", Infinity, NaN, true, {}, []]) {
    assert.equal(quotationModule.rentalObservationNumberIsValid(value, "joistClearWidthMm"), false, String(value));
  }
  for (const value of [0, "0", 430.5, "430.5", 5001, "5001"]) {
    assert.equal(quotationModule.rentalObservationNumberIsValid(value, "areaSquareMetres"), true, "Existing measurements retain their range and decimal behaviour");
  }
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

test("the same main heater shares its recorded RCAC cable run once without copying results or hiding uncaptured measurements", () => {
  const target = { moduleId: "module", sectionKey: "heating", checkKey: "heating_2027_readiness", instanceKey: "property", locationLabel: "Property" };
  const source = { ...target, checkKey: "main_living_heater", outcome: "meets", response: { applianceType: "Split system", model: "MODEL-A", serialNumber: "SERIAL-A", cableMeasurementStatus: "Measured", airconTotalCableMetres: 0, cableRouteBasis: "Switchboard beside unit; no additional cable run observed", credentialVerified: true, outcome: "meets" } };
  const before = structuredClone(source);
  const inherited = rentalSharedObservationResponse({ target, candidates: [source] });
  assert.deepEqual(inherited.response, { applianceType: "Split system", model: "MODEL-A", serialNumber: "SERIAL-A", cableMeasurementStatus: "Measured", airconTotalCableMetres: 0, cableRouteBasis: "Switchboard beside unit; no additional cable run observed" });
  assert.ok(["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis"].every(key => inherited.inheritedKeys.includes(key) && inherited.recordedKeys.includes(key)));
  assert.ok(!inherited.recordedKeys.includes("cableLimitationReason"), "An unrecorded optional limitation is not claimed as captured");
  assert.equal(Object.hasOwn(inherited.response, "outcome"), false);
  assert.equal(Object.hasOwn(inherited.response, "credentialVerified"), false);
  assert.equal(Object.hasOwn(inherited.response, "airconSwitchboardToOutdoorMetres"), false, "An earlier combined total cannot identify the switchboard-to-outdoor segment");
  assert.equal(Object.hasOwn(inherited.response, "airconOutdoorToIndoorMetres"), false, "An earlier combined total cannot identify the outdoor-to-indoor segment");
  assert.deepEqual(source, before);
  assert.deepEqual(rentalObservationBlockers({ checkKey: target.checkKey, outcome: "meets", response: inherited.response, enforceQuoteCapture: true }), []);
  const blank = rentalSharedObservationResponse({ target, candidates: [{ ...source, response: { applianceType: "Split system", model: "MODEL-A" } }] });
  for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis", "cableLimitationReason"]) assert.ok(!blank.recordedKeys.includes(key), "An earlier uncaptured cable field remains available to answer");
  for (const checkKey of ["main_living_heater", "heating_2027_readiness"]) {
    assert.ok(rentalObservationFields(checkKey).filter(field => ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis", "cableLimitationReason"].includes(field.key)).every(field => field.shared === true && field.captureVersion === 4));
  }
  for (const checkKey of ["cooktop_function", "hot_water_2027_readiness"]) assert.ok(rentalObservationFields(checkKey).filter(field => ["cableMeasurementStatus", "cableRouteBasis", "cableLimitationReason"].includes(field.key)).every(field => field.shared !== true));
  const captured = rentalSharedObservationResponse({ target, candidates: [source], currentResponse: { airconSwitchboardToOutdoorMetres: "15.2", airconOutdoorToIndoorMetres: "6.4" } });
  assert.equal(captured.response.airconSwitchboardToOutdoorMetres, "15.2");
  assert.equal(captured.response.airconOutdoorToIndoorMetres, "6.4");
  assert.ok(["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"].every((key) => !captured.inheritedKeys.includes(key)), "Distinct distances remain the future check's own recorded answers");
});

test("RCAC cable reuse retains identity boundaries and never overwrites a corrected current distance or explicit clear", () => {
  const target = { moduleId: "module", checkKey: "heating_2027_readiness", instanceKey: "property", locationLabel: "Property" };
  const source = { ...target, checkKey: "main_living_heater", outcome: "meets", response: { applianceType: "Split system", model: "MODEL-A", serialNumber: "SERIAL-A", cableMeasurementStatus: "Measured", airconTotalCableMetres: 12, cableRouteBasis: "Roof route" } };
  for (const currentResponse of [{ model: "MODEL-B" }, { serialNumber: "SERIAL-B" }, { applianceType: "Gas heater" }]) assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [source], currentResponse }).response, currentResponse);
  for (const changed of [{ moduleId: "other-module" }, { instanceKey: "other-heater" }, { locationLabel: "Bedroom" }, { checkKey: "cooling_2027_readiness" }, { checkKey: "cooktop_function" }, { checkKey: "hot_water_2027_readiness" }]) assert.deepEqual(rentalSharedObservationResponse({ target, candidates: [{ ...source, ...changed }] }).response, {}, JSON.stringify(changed));
  const currentResponse = { model: "MODEL-A", cableMeasurementStatus: "Estimated", airconTotalCableMetres: 14, cableRouteBasis: "Corrected route through hallway" };
  const corrected = rentalSharedObservationResponse({ target, candidates: [source], currentResponse });
  assert.deepEqual(corrected.response, { ...currentResponse, applianceType: "Split system", serialNumber: "SERIAL-A" }, "A changed measurement does not suggest a different heater or revive an earlier length");
  for (const key of ["cableMeasurementStatus", "airconTotalCableMetres", "cableRouteBasis"]) assert.ok(!corrected.inheritedKeys.includes(key));
  const explicitlyCleared = rentalSharedObservationResponse({ target, candidates: [source], currentResponse: { airconTotalCableMetres: "", cableRouteBasis: "" } });
  assert.equal(explicitlyCleared.response.airconTotalCableMetres, "");
  assert.equal(explicitlyCleared.response.cableRouteBasis, "");
  const latestCleared = rentalSharedObservationResponse({ target, candidates: [source, { ...source, response: { model: "MODEL-A", cableMeasurementStatus: "", airconTotalCableMetres: "", cableRouteBasis: "" } }] });
  assert.equal(Object.hasOwn(latestCleared.response, "airconTotalCableMetres"), false, "The latest source clear never revives an older source distance");
  assert.ok(!latestCleared.recordedKeys.includes("cableMeasurementStatus"));
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
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
  const record = { exports: {} };
  const dependencies = {
    react: React, "react/jsx-runtime": jsxRuntime,
    "@/lib/rental-quotation.mjs": quotationModule,
    "@/lib/rental-assessor-workflow.mjs": workflowModule,
    "@/lib/trade-rental-assessment.mjs": assessmentModule,
    "./TradeRentalInspectionPanel.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
    "./TradeWorkTimeTracking": { useFormTimeTracking: () => ({ bind: {}, markCompleted() {} }), WorkTimeStatus: () => null },
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
  assert.doesNotMatch(first, /<(?:input|select|textarea)[^>]*name="(?:cableMeasurementStatus|airconTotalCableMetres|airconSwitchboardToOutdoorMetres|airconOutdoorToIndoorMetres|cableRouteBasis|cableLimitationReason)"/, "The main-heater check does not repeat RCAC quoting questions");
  const candidates = [{ ...baseItem, id: "saved-heater", response: { applianceType: "Gas heater", model: "Recorded MODEL-42" } }];
  const later = render("heater_efficiency", candidates);
  assert.match(later, /Equipment details already recorded/);
  assert.match(later, /Recorded MODEL-42/);
  assert.doesNotMatch(later, /<(?:input|select|textarea)[^>]*name="(?:model|serialNumber|applianceType)"/);
  const future = render("heating_2027_readiness", candidates);
  assert.match(future, /<input(?=[^>]*type="number")(?=[^>]*name="roomLengthMetres")[^>]*>/);
  assert.match(future, /Room length \(m\)/);
  assert.doesNotMatch(future, /<(?:input|select|textarea)[^>]*name="(?:model|serialNumber|applianceType|measurement)"/);
  assert.match(future, /<select[^>]*name="cableMeasurementStatus"/, "An earlier heater identity without cable answers still asks for the first distance observation");
  const recordedCable = render("heating_2027_readiness", [{ ...candidates[0], response: { ...candidates[0].response, cableMeasurementStatus: "Measured", airconTotalCableMetres: 0, cableRouteBasis: "Switchboard beside unit" } }]);
  assert.doesNotMatch(recordedCable, /<(?:input|select|textarea)[^>]*name="(?:cableMeasurementStatus|airconTotalCableMetres|cableRouteBasis|cableLimitationReason)"/, "The recorded same-unit cable run is not asked for again at the future heating check");
  for (const key of ["airconSwitchboardToOutdoorMetres", "airconOutdoorToIndoorMetres"]) assert.match(recordedCable, new RegExp(`<input(?=[^>]*type="number")(?=[^>]*name="${key}")[^>]*>`), "A legacy total does not hide either unrecorded segment input");
  assert.match(recordedCable, /Switchboard beside unit/);
  const ceilingSection = template.sections.find((entry) => entry.key === "ceiling_insulation");
  const ceiling = renderToStaticMarkup(React.createElement(record.exports.AssessmentItemCard, {
    ...props, section: ceilingSection, check: ceilingSection.checks[0],
    item: { ...baseItem, sectionKey: ceilingSection.key, checkKey: ceilingSection.checks[0].key, response: { limitationStatus: "Unsafe to measure", limitationReason: "Locked hatch" } },
  }));
  const gapInput = ceiling.match(/<input[^>]*name="joistClearWidthMm"[^>]*>/)?.[0];
  assert.ok(gapInput, "The ceiling answer renders the joist measurement");
  for (const attribute of ['type="number"', 'inputMode="numeric"', 'min="1"', 'max="5000"', 'step="1"']) assert.ok(gapInput.includes(attribute), attribute);
  assert.doesNotMatch(gapInput, /required/);
  assert.match(ceiling, /Clear gap between ceiling joists \(mm\)/);
  assert.match(ceiling, /inside faces of adjacent ceiling joists/);
  assert.match(ceiling, /<input[^>]*name="limitationReason"[^>]*value="Locked hatch"/);
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
