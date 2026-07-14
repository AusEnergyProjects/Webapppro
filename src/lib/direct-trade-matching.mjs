import { assessParticipantRecord } from "./direct-trade-participants.mjs";

const CATEGORY_REQUIREMENTS = {
  assessment: ["assessment"],
  solar: ["solar"],
  battery: ["battery"],
  "heating-cooling": ["heating-cooling"],
  "hot-water": ["hot-water"],
  "insulation-draughts": ["insulation-draughts"],
  "ev-charging": ["ev-charging"],
  other: ["other"],
};

const QUOTE_EVIDENCE = {
  common: [
    ["scope", "Itemised scope, equipment, labour and exclusions"],
    ["credentials", "Current trade credentials, insurance and required approvals"],
    ["price", "Total price, deposit, payment stages and expiry date"],
    ["support", "Workmanship, product warranty and after-sales contacts"],
    ["assumptions", "Site, access, switchboard, structural and make-good assumptions"],
    ["incentives", "Every certificate, rebate or finance assumption shown separately"],
  ],
  assessment: [["assessment-method", "Assessment method, deliverables and assessor credentials"]],
  solar: [["solar-design", "System design, annual generation assumption, export limit and connection scope"], ["solar-products", "Panel and inverter models, quantities, datasheets and warranty terms"]],
  battery: [["battery-design", "Nominal and usable capacity, operating mode, backup scope and compatibility"], ["battery-products", "Battery and inverter models, datasheets, warranty throughput and support path"]],
  "heating-cooling": [["hvac-design", "Room loads, system sizing, efficiency rating, zoning, noise and condensate scope"]],
  "hot-water": [["hot-water-design", "Tank or delivery capacity, climate performance, tariff needs and backup operation"]],
  "insulation-draughts": [["fabric-scope", "Areas, R values, access, moisture, ventilation and electrical safety controls"]],
  "ev-charging": [["ev-scope", "Charger model, circuit capacity, load management, tariff and network assumptions"]],
  other: [["custom-scope", "A measurable scope and the evidence needed to compare suitable options"]],
};

function uniqueStrings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))] : [];
}

function canonicalState(value) {
  const aliases = { Vic: "VIC", Qld: "QLD", Tas: "TAS" };
  return aliases[value] || value || "";
}

function projectCapabilities(project) {
  return uniqueStrings(project?.projectCategories).flatMap((category) => CATEGORY_REQUIREMENTS[category] || []);
}

export function createQuoteEvidenceChecklist(project) {
  const categoryItems = uniqueStrings(project?.projectCategories).flatMap((category) => QUOTE_EVIDENCE[category] || []);
  const items = [...QUOTE_EVIDENCE.common, ...categoryItems];
  return [...new Map(items.map(([id, label]) => [id, { id, label, status: "not_requested" }])).values()];
}

export function buildDirectTradeTriage(project) {
  const categories = uniqueStrings(project?.projectCategories);
  const reviewFlags = [];
  if (project?.propertyRelationship === "planning-only") reviewFlags.push("property_authority_unconfirmed");
  if (categories.includes("other")) reviewFlags.push("custom_scope_requires_clarification");
  if (project?.projectStage === "researching" || project?.projectPriorities?.includes("need-advice")) reviewFlags.push("assessment_or_advice_may_be_needed_first");
  if (project?.propertyType === "apartment") reviewFlags.push("owners_corporation_or_shared_property_checks_may_apply");

  const priority = project?.projectStage === "replacement-urgent" || project?.timeframe === "urgent"
    ? "urgent_manual_review"
    : project?.projectStage === "seeking-quotes"
      ? "quote_ready_review"
      : "standard_review";

  return {
    version: "direct-trade-triage-1",
    status: reviewFlags.includes("property_authority_unconfirmed") ? "hold_for_authority_review" : "manual_matching_review",
    priority,
    autoSend: false,
    reviewFlags,
    matchCriteria: {
      state: canonicalState(project?.state),
      postcode: project?.postcode || "",
      capabilities: projectCapabilities(project),
      participantStatus: "approved",
      credentials: "current_and_verified",
    },
    quoteEvidence: createQuoteEvidenceChecklist(project),
  };
}

function participantRejection(project, participant, options) {
  const assessment = assessParticipantRecord(participant, options);
  if (!assessment.matchingEligible) return assessment.matchingFlags[0];
  if (!uniqueStrings(participant?.serviceStates).map(canonicalState).includes(canonicalState(project?.state))) return "outside_service_area";
  const capabilities = uniqueStrings(participant?.capabilities);
  if (!projectCapabilities(project).every((capability) => capabilities.includes(capability))) return "capability_mismatch";
  return "";
}

export function matchDirectTradeParticipants(project, participants, options = {}) {
  const postcodePrefix = String(project?.postcode || "").slice(0, 2);
  return (Array.isArray(participants) ? participants : []).map((participant) => {
    const rejection = participantRejection(project, participant, options);
    const localPrefixes = uniqueStrings(participant?.postcodePrefixes);
    const localFit = Boolean(postcodePrefix && localPrefixes.includes(postcodePrefix));
    return {
      participantId: String(participant?.id || ""),
      eligibleForReview: !rejection,
      score: rejection ? 0 : 100 + (localFit ? 10 : 0),
      reasons: rejection ? [rejection] : ["verified_coverage_and_capability", ...(localFit ? ["local_postcode_coverage"] : [])],
      autoSend: false,
    };
  }).filter((candidate) => candidate.participantId).sort((left, right) => right.score - left.score || left.participantId.localeCompare(right.participantId));
}

export function evaluateQuoteEvidence(checklist) {
  const items = Array.isArray(checklist) ? checklist : [];
  const accepted = items.filter((item) => item?.status === "accepted").length;
  const needsReview = items.filter((item) => item?.status === "needs_review").length;
  return {
    total: items.length,
    accepted,
    needsReview,
    complete: items.length > 0 && accepted === items.length,
  };
}
