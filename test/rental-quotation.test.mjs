import assert from "node:assert/strict";
import test from "node:test";
import { RENTAL_QUOTATION_FIELDS, rentalQuotation, rentalObservationBlockers, rentalObservationFields, rentalAssessorFields, rentalFindingDescriptionLabel } from "../src/lib/rental-quotation.mjs";
import { rentalAssessmentTemplateSnapshot, rentalAssessmentCompletion, rentalCheckIsReadiness, rentalRegimeAssessment } from "../src/lib/trade-rental-assessment.mjs";

const quotation = { status: "ready", measurements: "6 x 4 m = 24 m2, tape measured", specification: "R5 to bare area", access: "Hallway hatch; electrical clearance before work", exclusions: "Electrical rectification separately quoted" };
const finding = () => ({ title: "Insulate bare ceiling area", description: "Bare area above rear bedroom", tradeCategory: "Insulation installer", scopeSummary: "Install suitable R5 insulation to the measured area after clearance", quantityMilli: 24000, unitLabel: "m2", details: { quotation: { ...quotation } } });

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
  const item = { id: "seals", itemKey: "seals", sectionKey: "windows", checkKey: "seals", outcome: "does_not_meet" };
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
    for (const photoCount of [0, 1, undefined, NaN]) assert.ok(rentalObservationBlockers({ ...input, photoCount }).length);
  }
  const moduleTemplate = { key: "minimum_standards", sections: [{ key: "insulation", title: "Insulation", checks: [{ key: "ceiling_2027_readiness", required: true, repeatBy: "property", requiredEvidenceCount: 1 }] }] };
  const input = { moduleTemplate, items: [{ id: "ceiling", itemKey: "ceiling", sectionKey: "insulation", checkKey: "ceiling_2027_readiness", outcome: "does_not_meet", responseJson: {} }], findings: [{ itemId: "ceiling", title: "Bare ceiling", description: "No insulation above rear bedroom" }], evidenceCounts: { ceiling: 2 }, photoCounts: { ceiling: 2 } };
  assert.equal(rentalAssessmentCompletion(input).complete, false);
  input.items[0].responseJson.measurement = "Rear bedroom, 12 m2 bare area from 4 m x 3 m room dimensions";
  assert.equal(rentalAssessmentCompletion(input).complete, true);
});

test("electrical referral has no trade-writing wall and cannot bypass licensed verification", () => {
  const source = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
  const check = source.sections.find((section) => section.key === "electrical_safety").checks.find((entry) => entry.key === "outlet_lighting_protection");
  const input = { moduleTemplate: { key: source.key, credentialGate: source.credentialGate, sections: [{ key: "electrical_safety", title: "Electrical safety", checks: [check] }] }, items: [{ id: "board", itemKey: "board", sectionKey: "electrical_safety", checkKey: check.key, outcome: "specialist_verification_required", responseJson: {} }], findings: [{ itemId: "board", title: "Electrical observation", description: "Hallway board photographed. Circuit protection needs an electrician to check.", quantityMilli: 0, details: {} }], evidenceCounts: { board: 2 }, photoCounts: { board: 2 } };
  assert.deepEqual(rentalAssessorFields(check), []);
  assert.equal(rentalAssessmentCompletion(input).complete, true);
  input.items[0].outcome = "meets";
  assert.match(rentalAssessmentCompletion(input).blockers.map((blocker) => blocker.label).join(" "), /specialist credential/);
  const testCheck = { key: "rcd_testing", responseType: "test_result", responseFields: [{ key: "testResult", label: "Measured result", required: true }] };
  assert.deepEqual(rentalAssessorFields(testCheck), testCheck.responseFields);
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
  assert.match(rentalObservationFields("shower_2027_readiness").find((field) => field.key === "measurement").label, /litres\/minute.*timed seconds/);
  assert.match(rentalObservationFields("ceiling_2027_readiness").find((field) => field.key === "model").label, /Depth alone does not prove R-value/);
  assert.equal(rentalObservationFields("switchboard_observation").some((field) => field.key === "measurement"), false);
  assert.match(rentalFindingDescriptionLabel("not_accessible"), /could not be checked/);
  assert.match(rentalFindingDescriptionLabel("specialist_verification_required"), /could you see/);
  const oldCheck = { key: "ceiling_2027_readiness", responseType: "outcome", responseFields: [{ key: "measurement", label: "Target R-value and installation specification", required: false }] };
  assert.doesNotMatch(JSON.stringify(rentalAssessorFields(oldCheck)), /installation specification|target R-value|making good|service route/i);
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
  assert.equal(rentalAssessmentCompletion({ moduleTemplate, items: [item], answers: { ...answers, rentalRegime: "not_sure" }, evidenceCounts: {} }).complete, false);
  const readiness = rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027").modules.minimum_standards;
  assert.equal(rentalAssessmentCompletion({ moduleTemplate: readiness, items: [item], answers: { ...answers, rentalRegime: "not_sure" }, evidenceCounts: { one: 1 } }).complete, false, "Historical items outside the active scope cannot complete an empty observations report");
});
