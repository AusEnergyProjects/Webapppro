import { VIC_RENTAL_ASSESSMENT_TEMPLATE, VIC_RENTAL_ENERGY_READINESS_TEMPLATE, rentalCheckIsReadiness } from "./trade-rental-assessment.mjs";
import { RENTAL_OBSERVATION_SELECT_OPTIONS } from "./rental-quotation.mjs";
import { RENTAL_SHOWER_CHOICES, rentalAssessorCheckPresentation, rentalWindowIsFixed } from "./rental-assessor-workflow.mjs";

const recordedOutcomes = Object.freeze({
  meets: "Meets",
  does_not_meet: "Does not meet",
  specialist_verification_required: "Needs verification",
  not_accessible: "Could not check",
  not_applicable: "Does not apply",
  exemption_evidence_pending: "Possible exception; evidence needed",
  not_assessed: "Not assessed",
});
const genericStatusLabels = new Set(["meets", "does not meet", "specialist verification required", "not accessible", "not applicable", "exemption evidence pending", "not assessed"]);
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

/** A recorded answer is separate from its compliance/planning classification.
 * Newly issued reports freeze the label. Older reports can use the known check's
 * choices, but an unknown or historical check must never be guessed from "meets".
 * @param {unknown} value
 * @param {{moduleKey?:unknown, check?:unknown, assessmentScope?:unknown, applicabilityLimitation?:unknown}} [options]
 */
export function rentalReportAnswerPresentation(value, options = {}) {
  const item = record(value);
  const outcome = String(item.outcome || "not_assessed");
  const response = record(item.response);
  const key = String(item.checkKey || record(options.check).key || "");
  const modules = [VIC_RENTAL_ASSESSMENT_TEMPLATE, VIC_RENTAL_ENERGY_READINESS_TEMPLATE].flatMap((template) => Object.values(template.modules));
  const knownCheck = modules.filter((entry) => entry.key === options.moduleKey)
    .flatMap((module) => module.sections.flatMap((section) => section.checks)).find((entry) => entry.key === key);
  const check = options.check || knownCheck;
  const frozenOptions = record(check).outcomeOptions;
  const frozenChoice = Array.isArray(frozenOptions) ? frozenOptions.find((entry) => entry?.value === outcome) : undefined;
  const fallback = recordedOutcomes[outcome] || "Answer not recorded";
  let answer = typeof item.answerLabel === "string" ? item.answerLabel.trim() : "";
  if (!answer && options.moduleKey === "minimum_standards" && ["showerhead_rating", "shower_2027_readiness"].includes(key)) {
    // The rating was the selected answer, not a second Yes/No compliance response.
    if (["meets", "does_not_meet"].includes(outcome)) {
      answer = RENTAL_SHOWER_CHOICES.find((choice) => choice.value === response.welsRating)?.label || "";
    } else if (outcome === "specialist_verification_required") answer = "Rating not confirmed";
    else if (outcome === "not_applicable" && response.showerCaptureVersion === 1) answer = "No shower";
  }
  if (!answer && typeof frozenChoice?.label === "string" && !genericStatusLabels.has(frozenChoice.label.trim().toLowerCase())) answer = frozenChoice.label;
  if (!answer && key === "window_operation_security" && rentalWindowIsFixed(outcome, item.publicNotes)) {
    answer = String(item.publicNotes).includes("this window is not designed to open")
      ? "Fixed window; opening check does not apply" : "No openable windows";
  }
  if (!answer && knownCheck && !item.historicalObservation) {
    answer = rentalAssessorCheckPresentation(check, { outcome }).outcomeOptions.find((choice) => choice.value === outcome)?.label || "";
    if (key === "ceiling_2027_readiness" && ["meets", "does_not_meet"].includes(outcome)) {
      const rating = RENTAL_OBSERVATION_SELECT_OPTIONS.insulationRating.find((choice) => choice.value === response.insulationRating);
      if (rating) answer += `; existing insulation: ${rating.label}`;
    }
  }
  answer ||= fallback;
  const readiness = rentalCheckIsReadiness({ ...record(check), ...item }, options.assessmentScope);
  const context = options.applicabilityLimitation && options.moduleKey === "minimum_standards"
    ? "Legal applicability unconfirmed"
    : readiness && outcome === "meets" ? "Ready for the recorded requirement"
      : readiness && outcome === "does_not_meet" ? "Upgrade planning required" : "";
  return { label: answer, context };
}
