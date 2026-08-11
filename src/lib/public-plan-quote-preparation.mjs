import { isPublicPlanUpgradeInterest } from "./public-plan-enquiry.mjs";

export const PUBLIC_PLAN_QUOTE_PREPARATION_VERSION =
  "public-plan-desktop-quote-preparation-v1";
export const PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION =
  "2026-08-11-verified-matched-trade-quote-photos-v1";
export const PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE =
  "Share my selected quote answers and photos with approved TLink trades matched to this enquiry";
export const PUBLIC_PLAN_QUOTE_MAX_FILES = 12;
export const PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES = 48 * 1024 * 1024;
export const PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION = 8192;
export const PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS = 25_000_000;
export const PUBLIC_PLAN_QUOTE_ALLOWED_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
]);

const PUBLIC_PLAN_REFERENCE_PATTERN = /^AEA-\d{8}-[A-F0-9]{16}$/;
const PUBLIC_PLAN_UPLOAD_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PLAN_CLIENT_UPLOAD_ID_PATTERN =
  /^quote\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validPublicPlanQuoteUploadReference(sourceReference, uploadKey) {
  return PUBLIC_PLAN_REFERENCE_PATTERN.test(String(sourceReference || ""))
    && PUBLIC_PLAN_UPLOAD_KEY_PATTERN.test(String(uploadKey || ""));
}

export function validPublicPlanQuoteClientUploadId(clientUploadId) {
  return PUBLIC_PLAN_CLIENT_UPLOAD_ID_PATTERN.test(String(clientUploadId || ""));
}

export function publicPlanQuoteUploadKeyHashMatches(left, right) {
  const first = String(left || "");
  const second = String(right || "");
  if (first.length !== 64 || second.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

export function publicPlanQuoteWithdrawalDecision({
  status,
  suppliedKeyHash,
  storedKeyHash,
}) {
  if (!publicPlanQuoteUploadKeyHashMatches(suppliedKeyHash, storedKeyHash)) {
    return "reject";
  }
  if (status === "active") return "withdraw";
  if (status === "withdrawn") return "already-withdrawn";
  return "reject";
}

export function publicPlanQuoteUploadRateDecision(
  timestamps,
  now,
  { limit = PUBLIC_PLAN_QUOTE_MAX_FILES * 2, windowMs = 60 * 60 * 1000 } = {},
) {
  if (
    !Array.isArray(timestamps)
    || !timestamps.every((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)
    || !Number.isFinite(now)
  ) {
    return { allowed: false, unavailable: true };
  }
  const recent = timestamps.filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    return {
      allowed: false,
      recent,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((Math.min(...recent) + windowMs - now) / 1000),
      ),
    };
  }
  return { allowed: true, recent, nextTimestamps: [...recent, now] };
}

export function publicPlanQuotePhotoReplayDecision(existing, incoming) {
  if (!existing) return "new";
  if (
    existing.promptId !== incoming?.promptId
    || existing.contentType !== incoming?.contentType
    || existing.sha256 !== incoming?.sha256
  ) return "mismatch";
  return existing.status === "active" ? "replay" : "resume";
}

const ALL_SERVICES = Object.freeze([
  "assessment",
  "solar",
  "battery",
  "heating-cooling",
  "hot-water",
  "draught-proofing",
  "insulation",
  "glazing",
  "window-coverings",
  "ev-charging",
  "other",
]);

const QUESTION_DEFINITIONS = Object.freeze([
  {
    id: "timing",
    label: "When would you like the work done?",
    services: ALL_SERVICES,
    options: ["As soon as practical", "Within 3 months", "Within 6 months", "Planning for later", "Not sure"],
  },
  {
    id: "solar-scope",
    label: "What should the solar quote cover?",
    services: ["solar"],
    options: ["A new system", "Add to an existing system", "Replace an existing system", "Need advice"],
  },
  {
    id: "battery-priority",
    label: "What matters most for the battery quote?",
    services: ["battery"],
    options: ["Use more solar and lower bills", "Backup important circuits", "Both bill savings and backup", "Need advice"],
  },
  {
    id: "heating-coverage",
    label: "How much of the home should the heating or cooling quote cover?",
    services: ["heating-cooling"],
    options: ["One main room", "Several rooms", "Whole home", "Need advice"],
  },
  {
    id: "other-scope",
    label: "What upgrade or problem do you want help with?",
    services: ["other"],
    options: ["Replace existing equipment", "Install something new", "Repair or improve performance", "Need advice"],
  },
]);

const PHOTO_PROMPT_DEFINITIONS = Object.freeze([
  {
    id: "assessment-overview",
    label: "Wide views of the home or areas you want assessed",
    hint: "Stand back and show the whole room, wall or outdoor area so the assessor can understand the layout.",
    services: ["assessment"],
  },
  {
    id: "roof-wide",
    label: "Wide view of the roof from ground level",
    hint: "Show the main roof faces, shade and any existing solar. Do not climb onto the roof.",
    services: ["solar", "insulation"],
  },
  {
    id: "switchboard-front",
    label: "Full switchboard from the front",
    hint: "Show the whole switchboard from a safe standing position with only its normal hinged door open. Do not remove covers or touch wiring.",
    services: ["solar", "battery", "heating-cooling", "hot-water", "ev-charging"],
  },
  {
    id: "solar-battery-equipment-wide",
    label: "Wide view of inverter, solar and battery equipment",
    hint: "Show the whole inverter, battery or other solar equipment and the surrounding wall or work area. A close label photo is optional after the wide view.",
    services: ["solar", "battery"],
  },
  {
    id: "battery-installation-area",
    label: "Wide view of the proposed battery area",
    hint: "Stand back so the equipment location, nearby walls, doors and clearances are visible. Add a close label only as an optional second photo.",
    services: ["battery"],
  },
  {
    id: "heating-installation-area",
    label: "Wide views of the heating and cooling equipment and rooms",
    hint: "Show the whole indoor and outdoor units, the room or duct outlets, and nearby clearances. Add a close label only as an optional second photo.",
    services: ["heating-cooling"],
  },
  {
    id: "hot-water-installation-area",
    label: "Wide view of the whole hot-water system and surrounding space",
    hint: "Show the full unit, nearby walls, doors, pipework and clearances. Add a close label only as an optional second photo.",
    services: ["hot-water"],
  },
  {
    id: "ev-installation-area",
    label: "Wide view of the parking space and proposed charger area",
    hint: "Show the parking position, full wall area and likely cable path. A close charger label is optional after the wide photo.",
    services: ["ev-charging"],
  },
  {
    id: "other-installation-area",
    label: "Wide view of the proposed upgrade area",
    hint: "Stand back so the equipment location, nearby walls, doors and clearances are visible.",
    services: ["other"],
  },
  {
    id: "draught-area",
    label: "Wide view of the door, window, vent or chimney area",
    hint: "Show the whole opening and surrounding wall or floor. A close view of a visible gap is optional after the wide photo.",
    services: ["draught-proofing"],
  },
  {
    id: "insulation-access",
    label: "Safe view of insulation or the access opening",
    hint: "Photograph only what is visible safely. Do not enter a roof space or disturb insulation.",
    services: ["insulation"],
  },
  {
    id: "representative-window",
    label: "Full window and surrounding wall",
    hint: "Stand back so the whole window, frame, wall and any existing blind or shade are visible. A close gap photo is optional.",
    services: ["glazing", "window-coverings"],
  },
]);

const questionById = new Map(QUESTION_DEFINITIONS.map((item) => [item.id, item]));
const promptById = new Map(PHOTO_PROMPT_DEFINITIONS.map((item) => [item.id, item]));

function selectedServiceSet(services) {
  return new Set(
    Array.isArray(services)
      ? services.filter(isPublicPlanUpgradeInterest)
      : [],
  );
}

export function strictPublicPlanQuoteServiceCategories(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.some((service) =>
      typeof service !== "string" || !isPublicPlanUpgradeInterest(service))
  ) return [];
  return [...new Set(parsed)];
}

export function publicPlanQuoteCategoryIntersection(left, right) {
  const leftCategories = strictPublicPlanQuoteServiceCategories(left);
  const rightCategories = new Set(strictPublicPlanQuoteServiceCategories(right));
  if (!leftCategories.length || !rightCategories.size) return [];
  return leftCategories.filter((category) => rightCategories.has(category));
}

export function publicPlanQuoteAnswersForMatchedCategories(value, matchedCategories) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const services = publicPlanQuoteCategoryIntersection(
      item.services,
      matchedCategories,
    );
    const questionId = typeof item.questionId === "string" ? item.questionId : "";
    const label = typeof item.label === "string" ? item.label : "";
    const answer = typeof item.answer === "string" ? item.answer : "";
    return services.length && questionId && label && answer
      ? [{ questionId, label, answer, services }]
      : [];
  });
}

function intersects(services, selected) {
  return services.some((service) => selected.has(service));
}

export function publicPlanQuoteQuestionsForServices(services) {
  const selected = selectedServiceSet(services);
  return QUESTION_DEFINITIONS
    .filter((question) => intersects(question.services, selected))
    .map((question) => ({
      ...question,
      services: question.services.filter((service) => selected.has(service)),
    }));
}

const SWITCHBOARD_LABELS = Object.freeze({
  modern_breakers: "Modern circuit breakers",
  older_fuses: "Older fuse board",
  recent_upgrade: "Recently upgraded",
});
const ROOF_TYPE_LABELS = Object.freeze({
  metal: "Metal roof covering",
  tile: "Concrete or terracotta roof tiles",
  flat: "Membrane or another flat-roof covering",
  mixed: "Mixed roof coverings",
});
const ROOF_FORM_LABELS = Object.freeze({
  pitched: "Pitched or sloping roof",
  flat_low_pitch: "Flat or low-pitch roof",
  mixed: "Mixed roof forms",
});
const ROOF_CONDITION_LABELS = Object.freeze({
  good: "No known roof damage",
  weathered: "Older or weathered roof",
  known_issue: "Known roof leak, damage or condition issue",
});
const HEATING_COOLING_LABELS = Object.freeze([
  ["reverse-cycle", "Reverse-cycle air conditioning"],
  ["gas-heating", "Gas space or ducted heating"],
  ["hydronic-heating", "Hydronic heating"],
  ["wood-heating", "Wood fire or wood heater"],
  ["electric-resistance-heating", "Electric panel, portable or resistance heating"],
  ["evaporative-cooling", "Evaporative cooling"],
  ["fans-only", "Ceiling or portable fans"],
  ["heating-cooling-none", "No fixed heating or cooling"],
]);
const HOT_WATER_LABELS = Object.freeze([
  ["gas-storage-hot-water", "Gas storage hot water"],
  ["gas-continuous-flow-hot-water", "Continuous-flow gas hot water"],
  ["gas-hot-water-type-unknown", "Gas hot water, type not known"],
  ["heat-pump-hot-water", "Heat-pump hot water"],
  ["electric-storage-hot-water", "Electric storage hot water"],
  ["electric-instant-hot-water", "Instantaneous electric hot water"],
  ["solar-hot-water", "Solar hot water"],
  ["electric-gas-boosted-hot-water", "Electric hot water with gas booster"],
  ["hot-water-other", "Another hot-water type"],
]);
const INSULATION_LABELS = Object.freeze([
  ["ceiling-insulation-none", "Ceiling: none known"],
  ["ceiling-insulation-limited", "Ceiling: old, thin or patchy"],
  ["ceiling-insulation-well", "Ceiling: well insulated or recently upgraded"],
  ["ceiling-insulation-not-applicable", "Ceiling: another dwelling above"],
  ["wall-insulation-none", "External walls: none known"],
  ["wall-insulation-limited", "External walls: some, old or patchy"],
  ["wall-insulation-well", "External walls: well insulated or recently upgraded"],
  ["floor-insulation-none", "Underfloor: none known"],
  ["floor-insulation-limited", "Underfloor: some, old or patchy"],
  ["floor-insulation-well", "Underfloor: well insulated or recently upgraded"],
  ["floor-insulation-not-applicable", "Underfloor: slab or another dwelling below"],
]);
const SOLAR_LABELS = Object.freeze([
  ["solar", "Rooftop solar installed"],
  ["solar-none", "No rooftop solar"],
]);
const BATTERY_LABELS = Object.freeze([
  ["battery", "Home battery installed"],
  ["battery-none", "No home battery"],
]);

function labelsFromFeatures(features, definitions) {
  return definitions.flatMap(([feature, label]) => features.has(feature) ? [label] : []);
}

function compactKnownFacts(labels) {
  const unique = [...new Set(labels.filter(Boolean))];
  if (!unique.length) return "";
  const kept = [];
  for (const label of unique) {
    const remaining = unique.length - kept.length;
    const candidate = [...kept, label].join("; ");
    if (candidate.length + (remaining > 1 ? 14 : 0) > 160) break;
    kept.push(label);
  }
  const omitted = unique.length - kept.length;
  return `${kept.join("; ")}${omitted ? `; plus ${omitted} more` : ""}`.slice(0, 160);
}

function addKnownPlanFact(output, selectedServices, definition) {
  const services = definition.services.filter((service) => selectedServices.has(service));
  const answer = compactKnownFacts(definition.answers);
  if (!services.length || !answer) return;
  output.push({
    questionId: definition.questionId,
    label: definition.label,
    answer,
    services,
  });
}

export function publicPlanQuotePlanFactsForSnapshot(services, planSnapshot) {
  const selectedServices = selectedServiceSet(services);
  const propertyContext = planSnapshot && typeof planSnapshot === "object"
    && planSnapshot.propertyContext && typeof planSnapshot.propertyContext === "object"
    ? planSnapshot.propertyContext
    : {};
  const features = new Set(
    Array.isArray(planSnapshot?.features)
      ? planSnapshot.features.filter((value) => typeof value === "string")
      : [],
  );
  const facts = [];
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-switchboard",
    label: "Switchboard already recorded in the home plan",
    answers: [SWITCHBOARD_LABELS[propertyContext.switchboard]],
    services: ["solar", "battery", "heating-cooling", "hot-water", "ev-charging"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-roof",
    label: "Roof already recorded in the home plan",
    answers: [
      ROOF_TYPE_LABELS[propertyContext.roofType],
      ROOF_FORM_LABELS[propertyContext.roofForm],
      ROOF_CONDITION_LABELS[propertyContext.roofCondition],
    ],
    services: ["solar", "insulation"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-heating-cooling",
    label: "Heating and cooling already recorded in the home plan",
    answers: labelsFromFeatures(features, HEATING_COOLING_LABELS),
    services: ["heating-cooling"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-hot-water",
    label: "Hot water already recorded in the home plan",
    answers: labelsFromFeatures(features, HOT_WATER_LABELS),
    services: ["hot-water"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-insulation",
    label: "Insulation already recorded in the home plan",
    answers: labelsFromFeatures(features, INSULATION_LABELS),
    services: ["insulation"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-solar",
    label: "Rooftop solar already recorded in the home plan",
    answers: labelsFromFeatures(features, SOLAR_LABELS),
    services: ["solar"],
  });
  addKnownPlanFact(facts, selectedServices, {
    questionId: "known-plan-battery",
    label: "Home battery already recorded in the home plan",
    answers: labelsFromFeatures(features, BATTERY_LABELS),
    services: ["battery"],
  });
  return facts;
}

export function publicPlanQuoteQuestionsForSnapshot(services, _planSnapshot) {
  void _planSnapshot;
  return publicPlanQuoteQuestionsForServices(services);
}

export function publicPlanQuotePhotoPromptsForServices(services) {
  const selected = selectedServiceSet(services);
  return PHOTO_PROMPT_DEFINITIONS
    .filter((prompt) => intersects(prompt.services, selected))
    .map((prompt) => ({
      ...prompt,
      services: prompt.services.filter((service) => selected.has(service)),
    }));
}

function cleanAnswer(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
}

export function normalizePublicPlanQuotePreparation(raw, services, planSnapshot = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The quote preparation details could not be read." };
  }
  const allowedKeys = new Set([
    "version",
    "answers",
    "photoPromptIds",
    "expectedPhotoCount",
    "uploadKeyHash",
  ]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "The quote preparation details contained an unsupported field." };
  }
  if (raw.version !== PUBLIC_PLAN_QUOTE_PREPARATION_VERSION) {
    return { ok: false, error: "Refresh the page before sending the quote preparation details." };
  }
  const selectedServices = selectedServiceSet(services);
  const allowedQuestionDefinitions = publicPlanQuoteQuestionsForSnapshot(
    services,
    planSnapshot,
  );
  const allowedPlanFacts = publicPlanQuotePlanFactsForSnapshot(services, planSnapshot);
  const allowedPlanFactById = new Map(
    allowedPlanFacts.map((item) => [item.questionId, item]),
  );
  const allowedQuestions = new Set([
    ...allowedQuestionDefinitions.map((item) => item.id),
    ...allowedPlanFacts.map((item) => item.questionId),
  ]);
  const suppliedAnswers = new Map();
  if (!Array.isArray(raw.answers)) {
    return { ok: false, error: "The quote preparation answers could not be read." };
  }
  for (const supplied of raw.answers) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
      return { ok: false, error: "One quote preparation answer could not be read." };
    }
    if (Object.keys(supplied).some((key) => !["questionId", "answer"].includes(key))) {
      return { ok: false, error: "A quote preparation answer contained an unsupported field." };
    }
    const questionId = typeof supplied.questionId === "string"
      ? supplied.questionId.trim()
      : "";
    const answer = cleanAnswer(supplied.answer);
    if (!questionId || !allowedQuestions.has(questionId) || suppliedAnswers.has(questionId)) {
      return { ok: false, error: "A quote preparation answer did not match the selected services." };
    }
    const definition = questionById.get(questionId);
    const planFact = allowedPlanFactById.get(questionId);
    if (
      (!definition || !definition.options.includes(answer))
      && (!planFact || planFact.answer !== answer)
    ) {
      return { ok: false, error: "Choose one of the available quote preparation answers." };
    }
    suppliedAnswers.set(questionId, answer);
  }
  const interactiveAnswers = allowedQuestionDefinitions.flatMap((definition) => {
    const answer = suppliedAnswers.get(definition.id);
    return answer
      ? [{
        questionId: definition.id,
        label: definition.label,
        answer,
        services: definition.services.filter((service) => selectedServices.has(service)),
      }]
      : [];
  });
  const planFactAnswers = allowedPlanFacts.filter((fact) =>
    suppliedAnswers.get(fact.questionId) === fact.answer);
  const answers = [...interactiveAnswers, ...planFactAnswers];

  const allowedPrompts = new Set(
    publicPlanQuotePhotoPromptsForServices(services).map((item) => item.id),
  );
  if (!Array.isArray(raw.photoPromptIds)) {
    return { ok: false, error: "The quote photo prompts could not be read." };
  }
  const suppliedPhotoPromptIds = raw.photoPromptIds.map((value) =>
    typeof value === "string" ? value.trim() : "");
  if (
    new Set(suppliedPhotoPromptIds).size !== suppliedPhotoPromptIds.length
    || suppliedPhotoPromptIds.some((id) => !id || !allowedPrompts.has(id))
  ) {
    return { ok: false, error: "A quote photo did not match the selected services." };
  }
  const selectedPhotoPromptIds = new Set(suppliedPhotoPromptIds);
  const photoPromptIds = publicPlanQuotePhotoPromptsForServices(services)
    .map((item) => item.id)
    .filter((id) => selectedPhotoPromptIds.has(id));
  const expectedPhotoCount = Number(raw.expectedPhotoCount);
  if (
    !Number.isSafeInteger(expectedPhotoCount)
    || expectedPhotoCount < 0
    || expectedPhotoCount > PUBLIC_PLAN_QUOTE_MAX_FILES
    || (expectedPhotoCount > 0 && !photoPromptIds.length)
    || (expectedPhotoCount === 0 && photoPromptIds.length > 0)
    || photoPromptIds.length > expectedPhotoCount
  ) {
    return { ok: false, error: `Choose no more than ${PUBLIC_PLAN_QUOTE_MAX_FILES} quote photos.` };
  }
  const uploadKeyHash = typeof raw.uploadKeyHash === "string"
    ? raw.uploadKeyHash.trim().toLowerCase()
    : "";
  if (
    (expectedPhotoCount > 0 && !uploadKeyHash)
    || (uploadKeyHash && !/^[a-f0-9]{64}$/.test(uploadKeyHash))
  ) {
    return { ok: false, error: "The private quote photo upload reference was invalid." };
  }
  return {
    ok: true,
    value: {
      version: PUBLIC_PLAN_QUOTE_PREPARATION_VERSION,
      answers,
      photoPromptIds,
      expectedPhotoCount,
      uploadKeyHash,
    },
  };
}

export function publicPlanQuotePromptSnapshot(promptId, services) {
  const prompt = promptById.get(String(promptId || ""));
  const selected = selectedServiceSet(services);
  if (!prompt || !intersects(prompt.services, selected)) return null;
  return {
    promptId: prompt.id,
    label: prompt.label,
    services: prompt.services.filter((service) => selected.has(service)),
  };
}
