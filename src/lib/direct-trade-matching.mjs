import { assessParticipantRecord } from "./direct-trade-participants.mjs";
import { canonicalAustralianState } from "./australian-postcodes.mjs";
import { ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";

const CATEGORY_REQUIREMENTS = Object.fromEntries(
  ENERGY_SERVICE_IDS.map((service) => [service, [service]]),
);

const LEGACY_CATEGORY_ALIASES = {
  "insulation-draughts": ["insulation", "draught-proofing"],
};

const QUOTE_EVIDENCE = {
  common: [
    ["scope", "Itemised scope, equipment, labour and exclusions"],
    [
      "credentials",
      "Current trade credentials, insurance and required approvals",
    ],
    ["price", "Total price, deposit, payment stages and expiry date"],
    ["support", "Workmanship, product warranty and after-sales contacts"],
    [
      "assumptions",
      "Site, access, switchboard, structural and make-good assumptions",
    ],
    [
      "incentives",
      "Every certificate, rebate or finance assumption shown separately",
    ],
  ],
  assessment: [
    [
      "assessment-method",
      "Assessment method, deliverables and assessor credentials",
    ],
  ],
  "blower-door-testing": [
    [
      "blower-door-test-record",
      "Test purpose, method, building configuration, calibrated fan and manometer, result units, limitations and signed report",
    ],
  ],
  "thermal-imaging": [
    [
      "thermal-imaging-record",
      "Camera details, test conditions, temperature difference, paired visible and thermal images, locations, interpretation and limitations",
    ],
  ],
  solar: [
    [
      "solar-design",
      "System design, annual generation assumption, export limit and connection scope",
    ],
    [
      "solar-products",
      "Panel and inverter models, quantities, datasheets and warranty terms",
    ],
  ],
  battery: [
    [
      "battery-design",
      "Nominal and usable capacity, operating mode, backup scope and compatibility",
    ],
    [
      "battery-products",
      "Battery and inverter models, datasheets, warranty throughput and support path",
    ],
  ],
  "heating-cooling": [
    [
      "hvac-design",
      "Room loads, system sizing, efficiency rating, zoning, noise and condensate scope",
    ],
  ],
  "hot-water": [
    [
      "hot-water-design",
      "Tank or delivery capacity, climate performance, tariff needs and backup operation",
    ],
  ],
  "electric-cooking": [
    [
      "electric-cooking-scope",
      "Cooktop or freestanding appliance model, circuit and switchboard scope, kitchen fit, ventilation and safe gas disconnection",
    ],
  ],
  "draught-proofing": [
    [
      "draught-scope",
      "Leak locations, proposed seals, exclusions, ventilation, moisture and combustion safety checks",
    ],
  ],
  insulation: [
    [
      "insulation-scope",
      "Areas, existing and proposed R values, coverage, clearances, moisture and electrical safety controls",
    ],
  ],
  glazing: [
    [
      "glazing-schedule",
      "Opening schedule, glass and frame specifications, thermal and safety performance, installation and make-good scope",
    ],
  ],
  "window-coverings": [
    [
      "window-covering-scope",
      "Opening measurements, orientation, internal or external location, operation, fixing and shading or thermal intent",
    ],
  ],
  "ev-charging": [
    [
      "ev-scope",
      "Charger model, circuit capacity, load management, tariff and network assumptions",
    ],
  ],
  other: [
    [
      "custom-scope",
      "A measurable scope and the evidence needed to compare suitable options",
    ],
  ],
};

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item))]
    : [];
}

function normalizedCategories(value) {
  return [
    ...new Set(
      uniqueStrings(value).flatMap(
        (category) => LEGACY_CATEGORY_ALIASES[category] || [category],
      ),
    ),
  ];
}

function canonicalState(value) {
  return canonicalAustralianState(value) || "";
}

function projectCapabilities(project) {
  return normalizedCategories(project?.projectCategories).flatMap(
    (category) => CATEGORY_REQUIREMENTS[category] || [],
  );
}

export function createQuoteEvidenceChecklist(project) {
  const categoryItems = normalizedCategories(project?.projectCategories).flatMap(
    (category) => QUOTE_EVIDENCE[category] || [],
  );
  const items = [...QUOTE_EVIDENCE.common, ...categoryItems];
  return [
    ...new Map(
      items.map(([id, label]) => [id, { id, label, status: "not_requested" }]),
    ).values(),
  ];
}

export function buildDirectTradeTriage(project) {
  const categories = normalizedCategories(project?.projectCategories);
  const reviewFlags = [];
  if (project?.propertyRelationship === "planning-only")
    reviewFlags.push("property_authority_unconfirmed");
  if (categories.includes("other"))
    reviewFlags.push("custom_scope_requires_clarification");
  if (
    project?.projectStage === "researching" ||
    project?.projectPriorities?.includes("need-advice")
  )
    reviewFlags.push("assessment_or_advice_may_be_needed_first");
  if (project?.propertyType === "apartment")
    reviewFlags.push("owners_corporation_or_shared_property_checks_may_apply");

  const priority =
    project?.projectStage === "replacement-urgent" ||
    project?.timeframe === "urgent"
      ? "urgent_allocation_review"
      : project?.projectStage === "seeking-quotes"
        ? "quote_ready_allocation"
        : "standard_allocation";

  return {
    version: "direct-trade-triage-2",
    status: "automatic_privacy_safe_allocation",
    priority,
    autoSend: true,
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

export function selectEveryQualifiedTradeRecipient(candidates) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    if (
      !candidate
      || candidate.eligibleForReview === false
      || candidate.autoSend === false
    ) return false;
    const recipientId = String(
      candidate.firebaseUid || candidate.participantId || "",
    );
    if (!recipientId || seen.has(recipientId)) return false;
    seen.add(recipientId);
    return true;
  });
}

function participantRejection(project, participant, options) {
  const assessment = assessParticipantRecord(participant, options);
  if (!assessment.matchingEligible) return assessment.matchingFlags[0];
  if (
    !uniqueStrings(participant?.serviceStates)
      .map(canonicalState)
      .includes(canonicalState(project?.state))
  )
    return "outside_service_area";
  const capabilities = normalizedCategories(participant?.capabilities);
  if (
    !projectCapabilities(project).every((capability) =>
      capabilities.includes(capability),
    )
  )
    return "capability_mismatch";
  return "";
}

export function matchDirectTradeParticipants(
  project,
  participants,
  options = {},
) {
  const postcodePrefix = String(project?.postcode || "").slice(0, 2);
  return (Array.isArray(participants) ? participants : [])
    .map((participant) => {
      const rejection = participantRejection(project, participant, options);
      const localPrefixes = uniqueStrings(participant?.postcodePrefixes);
      const localFit = Boolean(
        postcodePrefix && localPrefixes.includes(postcodePrefix),
      );
      return {
        participantId: String(participant?.id || ""),
        eligibleForReview: !rejection,
        score: rejection ? 0 : 100 + (localFit ? 10 : 0),
        reasons: rejection
          ? [rejection]
          : [
              "verified_coverage_and_capability",
              ...(localFit ? ["local_postcode_coverage"] : []),
            ],
        autoSend: !rejection,
      };
    })
    .filter((candidate) => candidate.participantId)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.participantId.localeCompare(right.participantId),
    );
}

export function evaluateQuoteEvidence(checklist) {
  const items = Array.isArray(checklist) ? checklist : [];
  const accepted = items.filter((item) => item?.status === "accepted").length;
  const needsReview = items.filter(
    (item) => item?.status === "needs_review",
  ).length;
  return {
    total: items.length,
    accepted,
    needsReview,
    complete: items.length > 0 && accepted === items.length,
  };
}
