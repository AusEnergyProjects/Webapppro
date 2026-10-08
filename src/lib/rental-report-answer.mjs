import { VIC_RENTAL_ASSESSMENT_TEMPLATE, VIC_RENTAL_ENERGY_READINESS_TEMPLATE, rentalCheckIsReadiness, publicRentalReportValue } from "./trade-rental-assessment.mjs";
import { RENTAL_OBSERVATION_SELECT_OPTIONS, rentalObservationFields, rentalObservationFieldIsVisible, rentalObservationResponseProjection } from "./rental-quotation.mjs";
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

const currentSections = VIC_RENTAL_ASSESSMENT_TEMPLATE.modules.minimum_standards.sections;
const allTemplateModules = [VIC_RENTAL_ASSESSMENT_TEMPLATE, VIC_RENTAL_ENERGY_READINESS_TEMPLATE].flatMap((template) => Object.values(template.modules));
// Earlier issued reports include a separate switchboard photo-record check.
const legacyElectricalChecks = [
  { key: "switchboard_observation", required: true, prompt: "The switchboard and circuit schedule have been recorded." },
];
const futureStandards = Object.freeze({
  heating_2027_readiness: "A heater that fails beyond repair must be replaced with a qualifying energy-efficient heater when the new requirement applies.",
  cooling_2027_readiness: "The main living area must have qualifying fixed cooling when the new requirement applies.",
  hot_water_2027_readiness: "A hot water system that fails beyond repair must be replaced with a qualifying efficient system when the new requirement applies.",
  shower_2027_readiness: "Shower heads must have a verified 4-star WELS rating when the new requirement applies, unless a supported alternative is permitted.",
  ceiling_2027_readiness: "Ceiling areas with no insulation require R5.0 insulation when the new requirement applies. Existing insulation does not need upgrading solely because its rating is lower.",
  doors_2027_readiness: "External doors must have seals around their full perimeter and continue to open and close normally when the new requirement applies.",
  windows_2027_readiness: "External windows must have seals around their full perimeter and continue to open and close normally when the new requirement applies.",
  vents_2027_readiness: "Unsealed wall vents must be addressed when the new requirement applies, with any gas-safety ventilation needs checked before sealing.",
});
function knownReportCheck(item, moduleKey) {
  return allTemplateModules.filter((module) => module.key === moduleKey)
    .flatMap((module) => module.sections.flatMap((section) => section.checks)).find((check) => check.key === item.checkKey)
    || (moduleKey === "minimum_standards" ? legacyElectricalChecks.find((check) => check.key === item.checkKey) : undefined);
}

/** The assessed standard is distinct from an assessor's question or instruction. */
export function rentalReportCheckStandard(value, options = {}) {
  const item = record(value);
  if (item.verificationBasis === "licensed_electrician_video_review") return "The switchboard has the required circuit breaker and safety-switch protection.";
  return String(item.standardDescription || futureStandards[item.checkKey] || knownReportCheck(item, options.moduleKey)?.prompt || item.prompt || "Recorded assessment check");
}

/** Split mixed current/future sections without changing or losing the issued items.
 * @template {{key:string, title:string, summary:string, items:object[]}} TSection
 * @param {{key:string, assessmentScope?:string, sections:TSection[]}} assessmentModule
 * @returns {{current:Array<TSection & {number:number|null, heading:string, readiness:boolean}>, future:Array<TSection & {number:number|null, heading:string, readiness:boolean}>}}
 */
export function rentalReportSectionGroups(assessmentModule) {
  /** @type {{current:Array<TSection & {number:number|null, heading:string, readiness:boolean}>, future:Array<TSection & {number:number|null, heading:string, readiness:boolean}>}} */
  const groups = { current: [], future: [] };
  for (const section of assessmentModule.sections || []) {
    for (const future of [false, true]) {
      const items = (section.items || []).filter((item) => rentalCheckIsReadiness(item, assessmentModule.assessmentScope)
        || (assessmentModule.key === "minimum_standards" && Object.hasOwn(futureStandards, item.checkKey)) ? future : !future);
      if (!items.length) continue;
      const numberKey = section.key === "showers" ? "bathroom" : section.key;
      const currentIndex = currentSections.findIndex((entry) => entry.key === numberKey);
      const number = assessmentModule.key === "minimum_standards"
        ? ({ cooling: 16, hot_water: 17, ceiling_insulation: 18, draughtproofing: 19 }[numberKey] || (currentIndex >= 0 ? currentIndex + 1 : null)) : null;
      const title = future && section.key === "showers" ? "Shower heads" : section.title;
      groups[future ? "future" : "current"].push({ ...section, items, number, title,
        heading: number ? `${number}. ${title}${future && number <= 15 ? " (2027 change)" : ""}` : title,
        summary: future ? [...new Set(items.map((item) => rentalReportCheckStandard(item, { moduleKey: assessmentModule.key })))].join(" ")
          : currentSections.find((entry) => entry.key === section.key)?.summary || section.summary,
        readiness: future });
    }
  }
  return groups;
}

/** A cautious category summary; never converts missing or uncertain checks to a pass. */
export function rentalReportSectionResult(section, options = {}) {
  const items = (section.items || []).filter((item) => !item.historicalObservation);
  const result = (label, tone) => ({ label, tone });
  if (!items.length) return result("No current assessment", "caution");
  if (items.some((item) => item.outcome === "does_not_meet")) return result(section.readiness ? "Upgrade planning needed" : "Action required", section.readiness ? "caution" : "bad");
  if (items.every((item) => item.outcome === "not_accessible")) return result("Could not check", "caution");
  if (items.some((item) => !["meets", "not_applicable"].includes(item.outcome))) return result("Needs verification", "caution");
  if (options.applicabilityLimitation) return result("Legal applicability unconfirmed", "caution");
  if (items.every((item) => item.outcome === "not_applicable")) return result("Does not apply", "good");
  if (items.some((item) => !knownReportCheck(item, options.moduleKey))) return result("Recorded result; see details", "caution");
  const templateSections = section.readiness ? VIC_RENTAL_ENERGY_READINESS_TEMPLATE.modules.minimum_standards.sections : currentSections;
  const expected = options.moduleKey === "minimum_standards" ? templateSections.find((entry) => entry.key === section.key)?.checks || [] : [];
  if (expected.some((check) => check.required && !items.some((item) => item.checkKey === check.key))) return result("Partly assessed; see details", "caution");
  if (section.readiness) return result("Ready for assessed requirement", "good");
  if (["mould_damp", "structural_soundness"].includes(section.key)) return result("No issue observed", "good");
  return result("Meets assessed standard", "good");
}

/** Describe recorded coverage, not the inspection enum shared by current and safety-only reports.
 * @param {unknown} value An issued report or one of its modules.
 */
export function rentalReportScopeText(value) {
  const source = record(value);
  const modules = Array.isArray(source.modules) ? source.modules : Array.isArray(source.sections) ? [source] : [];
  const minimum = modules.filter((module) => module.key === "minimum_standards");
  if (!minimum.length && modules.length) return "This report records the selected safety checks completed for the property. Read the results, comments and any limits on what could be checked. Supporting photos and documents appear with the detailed checks and in the evidence register.";
  const groups = minimum.map((module) => rentalReportSectionGroups(module));
  const current = groups.some((group) => group.current.some((section) => section.items.some((item) => !item.historicalObservation)));
  const future = groups.some((group) => group.future.some((section) => section.items.some((item) => !item.historicalObservation)));
  if (current && future) return "This report checks the home's condition against Victoria's rental minimum standards and records its readiness for the new energy standards. Read the summary first, then the detailed checks, measurements and photos. These details help owners, agents and contractors understand and quote any work. Separate safety checks are included only where completed.";
  if (future) return "This report checks the home's readiness for Victoria's new rental energy standards. It explains what was found, what needs attention and what may need upgrading. Measurements and photos are included later to help plan and quote the work. Separate safety checks are included only where completed.";
  if (current) return "This report records the home's assessed condition against Victoria's rental minimum standards. It explains the checks completed, any areas that could not be checked and the findings. Measurements and photos are included later to help plan and quote any work. Separate safety checks are included only where completed.";
  if (groups.some((group) => group.current.length || group.future.length)) return "This report retains earlier assessment observations and their supporting evidence. No current minimum-standard or energy-readiness assessment is recorded in these sections.";
  return String(record(source.inspection).reportBoundary || source.reportBoundary || "This report records the selected assessment checks, findings and supporting evidence. Refer to each section for its scope and any assessment limits.");
}

/** Newly introduced quote inputs remain explicitly unknown in older reports. */
export function rentalReportObservationEntries(value) {
  const item = record(value);
  const response = record(publicRentalReportValue(item.historicalObservation ? item.response
    : rentalObservationResponseProjection(item.checkKey, item.outcome, record(item.response)).response));
  const entries = Object.entries(response).filter(([key, entry]) => key !== "showerCaptureVersion" && entry !== "" && entry !== null && entry !== undefined);
  for (const field of rentalObservationFields(item.checkKey)) {
    if (field.captureVersion !== 4 && field.key !== "joistClearWidthMm" || entries.some(([key]) => key === field.key)) continue;
    if (field.showIfAll && !rentalObservationFieldIsVisible({ ...field, showIf: undefined }, { outcome: item.outcome, response })) continue;
    if (field.showForOutcomes && !field.showForOutcomes.includes(item.outcome)) continue;
    if (field.showIf && !field.showIf.values.includes(response[field.showIf.key])) {
      const missingBasis = ["cableMeasurementStatus", "downlightCountStatus"].includes(field.showIf.key) && !response[field.showIf.key];
      if (!missingBasis || ["cableLimitationReason", "downlightCountLimitation"].includes(field.key)) continue;
    }
    entries.push([field.key, "Not recorded"]);
  }
  return entries;
}

/** Older snapshots retained inactive answers in response; new snapshots freeze them separately. */
export function rentalReportRetainedObservationEntries(value) {
  const item = record(value);
  const projected = item.historicalObservation ? {} : rentalObservationResponseProjection(item.checkKey, item.outcome, record(item.response)).retainedResponse;
  return Object.entries(record(publicRentalReportValue({ ...projected, ...record(item.retainedResponse) })))
    .filter(([key, entry]) => key !== "showerCaptureVersion" && entry !== "" && entry !== null && entry !== undefined);
}

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
  const knownCheck = knownReportCheck({ checkKey: key }, options.moduleKey);
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
