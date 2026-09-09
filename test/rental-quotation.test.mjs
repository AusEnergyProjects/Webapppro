import assert from "node:assert/strict";
import test from "node:test";
import { RENTAL_QUOTATION_FIELDS, rentalQuotation, rentalQuotationBlockers, rentalObservationFields } from "../src/lib/rental-quotation.mjs";
import { rentalAssessmentTemplateSnapshot, rentalAssessmentCompletion, rentalCheckIsReadiness, rentalRegimeAssessment } from "../src/lib/trade-rental-assessment.mjs";

const quotation = { status: "ready", measurements: "6 x 4 m = 24 m2, tape measured", specification: "R5 to bare area", access: "Hallway hatch; electrical clearance before work", exclusions: "Electrical rectification separately quoted" };
const finding = () => ({ title: "Insulate bare ceiling area", description: "Bare area above rear bedroom", tradeCategory: "Insulation installer", scopeSummary: "Install suitable R5 insulation to the measured area after clearance", quantityMilli: 24000, unitLabel: "m2", details: { quotation: { ...quotation } } });

test("finalisation requires a complete quotation scope and photos without a readiness choice", () => {
  assert.deepEqual(rentalQuotationBlockers(finding(), 2), []);
  for (const key of ["measurements", "specification", "access", "exclusions"]) {
    const partial = finding(); partial.details.quotation[key] = "";
    assert.ok(rentalQuotationBlockers(partial, 2).length, key);
  }
  assert.ok(rentalQuotationBlockers({ ...finding(), quantityMilli: 0 }, 2).length);
  assert.ok(rentalQuotationBlockers({ ...finding(), unitLabel: "" }, 2).length);
  for (const count of [0, 1, undefined, NaN]) assert.ok(rentalQuotationBlockers(finding(), count).length);
  assert.ok(rentalQuotationBlockers({ ...finding(), details: { quotation: { status: "further_information", missingInformation: "Return for measurements" } } }, 2).length, "The retired escape path cannot finalise an incomplete scope");
  const current = finding(); delete current.details.quotation.status;
  assert.deepEqual(rentalQuotationBlockers(current, 2), []);
  const legacy = rentalQuotation({ exclusions: "Disposal included", missingInformation: "Concealed framing was not visible" });
  assert.match(legacy.exclusions, /Concealed framing was not visible/);
  assert.equal(Object.hasOwn(legacy, "status"), false);
  assert.deepEqual(rentalQuotation(legacy), legacy, "Legacy limitations are preserved once without duplication");
  const longLegacy = rentalQuotation({ exclusions: "A".repeat(4000), missingInformation: "B".repeat(4000) });
  assert.ok(longLegacy.exclusions.endsWith("B".repeat(4000)));
  assert.ok(longLegacy.exclusions.length <= RENTAL_QUOTATION_FIELDS.find((field) => field.key === "exclusions").maxLength);
});

test("new and older rental findings require quotation details and photos without naming a trade", () => {
  const moduleTemplate = { key: "minimum_standards", sections: [{ key: "windows", title: "Window sealing", checks: [{ key: "seals", required: true, requiredEvidenceCount: 1, repeatBy: "property" }] }] };
  const item = { id: "seals", itemKey: "seals", sectionKey: "windows", checkKey: "seals", outcome: "does_not_meet" };
  const input = { moduleTemplate, items: [item], findings: [{ ...finding(), itemId: "seals", tradeCategory: "" }], evidenceCounts: { seals: 2 }, photoCounts: { seals: 2 } };
  for (const templateVersion of [1, 2, 3]) {
    input.moduleTemplate.templateVersion = templateVersion;
    const result = rentalAssessmentCompletion(input);
    assert.equal(result.complete, true, JSON.stringify(result.blockers));
    assert.equal(rentalAssessmentCompletion({ ...input, photoCounts: {} }).complete, false, "Documents cannot replace location/detail photos");
    assert.equal(rentalAssessmentCompletion({ ...input, findings: [{ ...input.findings[0], details: {} }] }).complete, false);
  }
  input.items[0].outcome = "specialist_verification_required";
  input.findings[0] = { ...input.findings[0], title: "Test circuit protection", description: "Protection requires licensed verification", scopeSummary: "Test one switchboard and issue the testing record", quantityMilli: 1000, unitLabel: "switchboard", details: { quotation: { measurements: "One board, hallway, labelled circuits photographed", specification: "Verify RCD and circuit-breaker protection; provide testing results", access: "Vacant home, hallway access, isolation appointment included", exclusions: "Testing and report included; concealed rectification excluded" } } };
  assert.equal(rentalAssessmentCompletion(input).complete, true, "A fully described licensed testing task is quotable without declaring the equipment compliant");
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
  for (const key of ["switchboard_observation", "cooktop_function", "oven_function", "heating_2027_readiness", "cooling_2027_readiness", "hot_water_2027_readiness", "ceiling_2027_readiness", "doors_2027_readiness", "windows_2027_readiness", "shower_2027_readiness"]) {
    const fields = rentalObservationFields(key);
    assert.ok(fields.some((field) => field.key === "measurement"), key);
    assert.ok(fields.some((field) => field.key === "limitationReason"), key);
    assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  }
  assert.match(rentalObservationFields("shower_2027_readiness").find((field) => field.key === "measurement").label, /litres\/minute.*timed seconds/);
  assert.match(rentalObservationFields("ceiling_2027_readiness").find((field) => field.key === "model").label, /Depth alone does not prove R-value/);
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
