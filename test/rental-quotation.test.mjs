import assert from "node:assert/strict";
import test from "node:test";
import { rentalQuotation, rentalQuotationBlockers, rentalObservationFields } from "../src/lib/rental-quotation.mjs";
import { rentalAssessmentTemplateSnapshot, rentalAssessmentCompletion, rentalCheckIsReadiness, rentalRegimeAssessment } from "../src/lib/trade-rental-assessment.mjs";
import { rentalSuggestedTrade, RENTAL_REFERRAL_TRADES } from "../src/lib/rental-referral-trades.mjs";

const quotation = { status: "ready", measurements: "6 x 4 m = 24 m2, tape measured", specification: "R5 to bare area", access: "Hallway hatch; electrical clearance before work", exclusions: "Electrical rectification separately quoted" };
const finding = () => ({ title: "Insulate bare ceiling area", description: "Bare area above rear bedroom", tradeCategory: "Insulation installer", scopeSummary: "Install suitable R5 insulation to the measured area after clearance", quantityMilli: 24000, unitLabel: "m2", details: { quotation: { ...quotation } } });

test("quote readiness requires measured scope, access, specification, exclusions and evidence", () => {
  assert.deepEqual(rentalQuotationBlockers(finding(), "does_not_meet", 2), []);
  for (const key of ["measurements", "specification", "access", "exclusions"]) {
    const partial = finding(); partial.details.quotation[key] = "";
    assert.ok(rentalQuotationBlockers(partial, "does_not_meet", 2).length, key);
  }
  assert.ok(rentalQuotationBlockers({ ...finding(), quantityMilli: 0 }, "does_not_meet", 2).length);
  assert.ok(rentalQuotationBlockers(finding(), "does_not_meet", 1).length);
  const unresolved = finding(); unresolved.details.quotation.missingInformation = "Site measurement still required.";
  assert.ok(rentalQuotationBlockers(unresolved, "does_not_meet", 2).length);
  for (const outcome of ["not_accessible", "specialist_verification_required", "exemption_evidence_pending"]) assert.ok(rentalQuotationBlockers(finding(), outcome, 2).length);
  assert.ok(rentalQuotationBlockers({ ...finding(), details: {} }, "does_not_meet", 2).length);
  assert.deepEqual(rentalQuotationBlockers({ ...finding(), details: { quotation: { status: "further_information", missingInformation: "Electrician to verify concealed services." } } }, "specialist_verification_required", 1), []);
  assert.equal(rentalQuotation({ status: { arbitrary: true } }).status, "");
});

test("new full assessments preserve all 15 current categories and distinguish eight future checks", () => {
  const template = rentalAssessmentTemplateSnapshot(["minimum_standards"]);
  const checks = template.modules.minimum_standards.sections.flatMap((section) => section.checks);
  assert.equal(checks.length, 32);
  assert.equal(checks.filter((check) => rentalCheckIsReadiness(check, template.assessmentScope)).length, 8);
  assert.equal(checks.filter((check) => !rentalCheckIsReadiness(check, template.assessmentScope)).length, 24);
  assert.equal(rentalCheckIsReadiness({}, "energy_readiness_2027"), true, "Historical readiness snapshots retain their meaning");
  assert.equal(rentalCheckIsReadiness({ assessmentPhase: "current" }, "energy_readiness_2027"), false);
  assert.ok(RENTAL_REFERRAL_TRADES.includes("Insulation installer"));
  assert.equal(rentalSuggestedTrade("ceiling_2027_readiness"), "Insulation installer");
  assert.equal(rentalSuggestedTrade("unknown_check"), "");
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
