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
    id: "site-access",
    label: "Can the work area be reached easily and safely?",
    services: ["assessment", "solar", "insulation", "glazing", "window-coverings", "other"],
    options: ["Yes", "Limited access", "Access needs arranging", "Not sure"],
  },
  {
    id: "switchboard",
    label: "What type of switchboard is installed?",
    services: ["solar", "battery", "heating-cooling", "hot-water", "ev-charging"],
    options: ["Modern circuit breakers", "Older fuse board", "Recently upgraded", "Not sure"],
  },
  {
    id: "roof-details",
    label: "What is the main roof covering and condition?",
    services: ["solar"],
    options: ["Metal and sound", "Tile and sound", "Repairs may be needed", "Flat or unusual roof", "Not sure"],
  },
  {
    id: "existing-solar",
    label: "What solar system is already installed?",
    services: ["battery"],
    options: ["No solar", "Solar under 5 kW", "Solar 5 to 10 kW", "Solar over 10 kW", "Not sure"],
  },
  {
    id: "battery-goal-location",
    label: "What matters most for the battery and where could it go?",
    services: ["battery"],
    options: ["Use more solar, suitable outdoor wall", "Backup power, suitable outdoor wall", "Garage or utility area", "Location needs advice", "Not sure"],
  },
  {
    id: "existing-heating-equipment",
    label: "What heating or cooling equipment is installed now?",
    services: ["heating-cooling"],
    options: ["Gas", "Electric resistance", "Heat pump or reverse cycle", "Wood or another fuel", "Nothing installed", "Not sure"],
  },
  {
    id: "existing-hot-water-equipment",
    label: "What hot-water system is installed now?",
    services: ["hot-water"],
    options: ["Gas", "Electric resistance", "Heat pump", "Solar hot water", "Other", "Not sure"],
  },
  {
    id: "existing-other-equipment",
    label: "What equipment or fuel is involved in this other upgrade?",
    services: ["other"],
    options: ["Gas", "Electric resistance", "Heat pump or reverse cycle", "Wood or another fuel", "Nothing installed", "Not sure"],
  },
  {
    id: "heating-scope",
    label: "Which areas need heating or cooling, and what is wrong now?",
    services: ["heating-cooling"],
    options: ["One main room", "Several rooms", "Whole home", "Replace a failed system", "Need advice"],
  },
  {
    id: "hot-water-location",
    label: "Where is the current hot-water unit and is there clear space nearby?",
    services: ["hot-water"],
    options: ["Outside with clear space", "Outside with limited space", "Inside", "Roof mounted", "Not sure"],
  },
  {
    id: "draught-locations",
    label: "Where are the noticeable draughts?",
    services: ["draught-proofing"],
    options: ["External doors", "Windows", "Exhaust fans or vents", "Chimney or fireplace", "Several areas", "Not sure"],
  },
  {
    id: "fixed-ventilation",
    label: "Are any openings required for ventilation or an unflued gas appliance?",
    services: ["draught-proofing"],
    options: ["Yes", "No", "There is an open fireplace or chimney", "Not sure"],
  },
  {
    id: "insulation-area",
    label: "Which insulation area needs attention?",
    services: ["insulation"],
    options: ["Ceiling or roof", "External walls", "Underfloor", "Several areas", "Not sure"],
  },
  {
    id: "insulation-known",
    label: "What is known about the existing insulation?",
    services: ["insulation"],
    options: ["No insulation in known areas", "Old, thin or patchy in known areas", "Well insulated or recently upgraded", "Mixed or varies by area", "Plans or rating available", "Not sure"],
  },
  {
    id: "window-construction",
    label: "What best describes the windows being considered?",
    services: ["glazing", "window-coverings"],
    options: ["Single glazing, aluminium frame", "Single glazing, timber or uPVC frame", "Double glazing", "Mixed windows", "Not sure"],
  },
  {
    id: "window-priority",
    label: "What is the main window problem and approximate scope?",
    services: ["glazing"],
    options: ["Winter heat loss", "Summer heat gain", "Noise or condensation", "One or two windows", "Several rooms", "Whole home", "Not sure"],
  },
  {
    id: "shading-access",
    label: "Can shading be fitted outside, or must it stay inside?",
    services: ["window-coverings"],
    options: ["Outside is possible", "Inside only", "Body corporate or strata approval may apply", "Not sure"],
  },
  {
    id: "ev-needs",
    label: "What vehicle and charging speed are you planning for?",
    services: ["ev-charging"],
    options: ["Plug-in hybrid or slow overnight charging", "Single EV home charger", "Higher-speed or future second EV", "Vehicle not chosen", "Not sure"],
  },
  {
    id: "ev-parking",
    label: "Where is the parking space compared with the switchboard?",
    services: ["ev-charging"],
    options: ["Same garage or nearby", "Across the house", "Detached garage or carport", "Shared or strata parking", "Not sure"],
  },
  {
    id: "assessment-concerns",
    label: "What should the assessor focus on first?",
    services: ["assessment"],
    options: ["High bills", "Comfort or draughts", "Electrification plan", "Solar, battery or rebates", "Whole-home advice", "Not sure"],
  },
  {
    id: "assessment-records",
    label: "What useful records are available?",
    services: ["assessment"],
    options: ["Recent energy bills", "Plans or previous assessment", "Appliance details", "Several records", "None or not sure"],
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
    id: "solar-equipment-label",
    label: "Existing solar inverter or equipment label",
    hint: "Take a clear close photo showing the brand, model and rating plate.",
    services: ["solar"],
  },
  {
    id: "battery-equipment-label",
    label: "Existing solar inverter or battery label",
    hint: "Take a clear close photo showing the brand, model and rating plate.",
    services: ["battery"],
  },
  {
    id: "heating-equipment-label",
    label: "Existing heating or cooling equipment label",
    hint: "Take a clear close photo showing the brand, model and rating plate.",
    services: ["heating-cooling"],
  },
  {
    id: "hot-water-equipment-label",
    label: "Existing hot-water system label",
    hint: "Take a clear close photo showing the brand, model and rating plate.",
    services: ["hot-water"],
  },
  {
    id: "ev-equipment-label",
    label: "Existing charger or proposed charger label",
    hint: "Take a clear close photo showing the brand, model and rating plate when available.",
    services: ["ev-charging"],
  },
  {
    id: "other-equipment-label",
    label: "Existing equipment label for this upgrade",
    hint: "Take a clear close photo showing the brand, model and rating plate when available.",
    services: ["other"],
  },
  {
    id: "battery-installation-area",
    label: "Wide view of the proposed battery area",
    hint: "Stand back so the equipment location, nearby walls, doors and clearances are visible.",
    services: ["battery"],
  },
  {
    id: "heating-installation-area",
    label: "Wide view of the heating or cooling area",
    hint: "Show the proposed indoor and outdoor equipment locations and nearby clearances.",
    services: ["heating-cooling"],
  },
  {
    id: "hot-water-installation-area",
    label: "Wide view around the hot-water system",
    hint: "Show the current unit, nearby walls, doors, pipework and clearances.",
    services: ["hot-water"],
  },
  {
    id: "ev-installation-area",
    label: "Wide view of the parking and charger area",
    hint: "Show the parking position, proposed charger wall and cable path where possible.",
    services: ["ev-charging"],
  },
  {
    id: "other-installation-area",
    label: "Wide view of the proposed upgrade area",
    hint: "Stand back so the equipment location, nearby walls, doors and clearances are visible.",
    services: ["other"],
  },
  {
    id: "switchboard-front",
    label: "Switchboard with the door open from the front",
    hint: "Photograph only from a safe standing position. Do not remove covers or touch wiring.",
    services: ["solar", "battery", "heating-cooling", "hot-water", "ev-charging"],
  },
  {
    id: "roof-wide",
    label: "Wide photo of the roof from ground level",
    hint: "Show the main roof faces, shade and any existing solar. Do not climb onto the roof.",
    services: ["solar", "insulation"],
  },
  {
    id: "draught-area",
    label: "Door, window, vent or chimney where the draught is felt",
    hint: "Include one close view and one wider view if useful.",
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
    label: "Representative window, frame and surrounding wall",
    hint: "Show the full window plus a close view of the frame or gap.",
    services: ["glazing", "window-coverings"],
  },
  {
    id: "assessment-overview",
    label: "Home or area you most want assessed",
    hint: "A few wide photos can help the assessor understand the layout before visiting.",
    services: ["assessment"],
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

function knownPlanFact(value) {
  return Boolean(
    typeof value === "string" && value.trim() && value.trim() !== "not_sure",
  );
}

const KNOWN_INSULATION_FEATURES = new Set([
  "ceiling-insulation-none",
  "ceiling-insulation-limited",
  "ceiling-insulation-well",
  "ceiling-insulation-not-applicable",
  "wall-insulation-none",
  "wall-insulation-limited",
  "wall-insulation-well",
  "floor-insulation-none",
  "floor-insulation-limited",
  "floor-insulation-well",
  "floor-insulation-not-applicable",
]);
const KNOWN_HEATING_COOLING_FEATURES = new Set([
  "reverse-cycle",
  "gas-heating",
  "hydronic-heating",
  "wood-heating",
  "electric-resistance-heating",
  "evaporative-cooling",
  "fans-only",
  "heating-cooling-none",
]);
const KNOWN_HOT_WATER_FEATURES = new Set([
  "gas-storage-hot-water",
  "gas-continuous-flow-hot-water",
  "gas-hot-water-type-unknown",
  "heat-pump-hot-water",
  "electric-storage-hot-water",
  "electric-instant-hot-water",
  "solar-hot-water",
  "electric-gas-boosted-hot-water",
  "hot-water-other",
]);

export function publicPlanQuoteQuestionsForSnapshot(services, planSnapshot) {
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
  const defaults = new Map();
  const switchboardDefaults = {
    modern_breakers: "Modern circuit breakers",
    older_fuses: "Older fuse board",
    recent_upgrade: "Recently upgraded",
  };
  if (knownPlanFact(propertyContext.switchboard)) {
    const answer = switchboardDefaults[propertyContext.switchboard];
    if (answer) defaults.set("switchboard", answer);
  }
  const roofDefault = propertyContext.roofCondition === "known_issue"
    ? "Repairs may be needed"
    : propertyContext.roofType === "flat"
      ? "Flat or unusual roof"
      : propertyContext.roofCondition === "good" && propertyContext.roofType === "metal"
        ? "Metal and sound"
        : propertyContext.roofCondition === "good" && propertyContext.roofType === "tile"
          ? "Tile and sound"
          : "";
  if (roofDefault) defaults.set("roof-details", roofDefault);

  const insulationFacts = [...features]
    .filter((feature) => KNOWN_INSULATION_FEATURES.has(feature));
  const insulationKinds = new Set(insulationFacts.map((feature) =>
    feature.endsWith("-none")
      ? "none"
      : feature.endsWith("-limited")
        ? "limited"
        : feature.endsWith("-well")
          ? "well"
          : "not-applicable"));
  const insulationDefault = insulationKinds.size > 1
    ? "Mixed or varies by area"
    : insulationKinds.has("none")
      ? "No insulation in known areas"
      : insulationKinds.has("limited")
        ? "Old, thin or patchy in known areas"
        : insulationKinds.has("well")
          ? "Well insulated or recently upgraded"
          : "";
  if (insulationDefault) defaults.set("insulation-known", insulationDefault);
  if (selectedServices.has("battery") && features.has("solar-none")) {
    defaults.set("existing-solar", "No solar");
  }
  if (selectedServices.has("heating-cooling")) {
    const answers = new Set([...features].flatMap((feature) => {
      if (!KNOWN_HEATING_COOLING_FEATURES.has(feature)) return [];
      if (feature === "gas-heating") return ["Gas"];
      if (feature === "electric-resistance-heating") return ["Electric resistance"];
      if (feature === "reverse-cycle") return ["Heat pump or reverse cycle"];
      if (feature === "wood-heating") return ["Wood or another fuel"];
      if (feature === "heating-cooling-none") return ["Nothing installed"];
      return [];
    }));
    if (answers.size === 1) {
      defaults.set("existing-heating-equipment", [...answers][0]);
    }
  }
  if (selectedServices.has("hot-water")) {
    const answers = new Set([...features].flatMap((feature) => {
      if (!KNOWN_HOT_WATER_FEATURES.has(feature)) return [];
      if (feature.startsWith("gas-")) return ["Gas"];
      if (["electric-storage-hot-water", "electric-instant-hot-water"].includes(feature)) {
        return ["Electric resistance"];
      }
      if (feature === "heat-pump-hot-water") return ["Heat pump"];
      if (["solar-hot-water", "electric-gas-boosted-hot-water"].includes(feature)) {
        return ["Solar hot water"];
      }
      if (feature === "hot-water-other") return ["Other"];
      return [];
    }));
    if (answers.size === 1) {
      defaults.set("existing-hot-water-equipment", [...answers][0]);
    }
  }
  return publicPlanQuoteQuestionsForServices(services)
    .map((question) => ({
      ...question,
      defaultAnswer: defaults.get(question.id) || "",
      answerSource: defaults.has(question.id) ? "private-plan" : "quote-preparation",
    }));
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
  const allowedQuestions = new Set(allowedQuestionDefinitions.map((item) => item.id));
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
    if (!definition?.options.includes(answer)) {
      return { ok: false, error: "Choose one of the available quote preparation answers." };
    }
    suppliedAnswers.set(questionId, answer);
  }
  const answers = allowedQuestionDefinitions.flatMap((definition) => {
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
