const REVIEW_KINDS = new Set([
  "question",
  "customer-recorded-feedback",
  "proposed-change",
]);
const REVIEW_TARGET_TYPES = new Set(["fact", "plan-item", "general"]);
const REVIEW_STATUSES = new Set(["open", "answered", "accepted", "declined"]);

export const customerReviewOptions = {
  kinds: [
    ["question", "Question to discuss"],
    ["customer-recorded-feedback", "Feedback recorded by you"],
    ["proposed-change", "Proposed plan change"],
  ],
  statuses: [
    ["open", "Open"],
    ["answered", "Answered"],
    ["accepted", "Accepted by you"],
    ["declined", "Not using"],
  ],
};

const ITEM_FACTS = {
  "evidence-confidence": [],
  "climate-sequence": [],
  "room-comfort-profile": [],
  authority: [],
  assessment: [],
  compare: [],
  "compare-gas": [],
  fabric: ["draughts", "ceiling-insulation", "wall-insulation", "floor-insulation"],
  "draught-proofing": ["draughts"],
  "insulation-review": ["ceiling-insulation", "wall-insulation", "floor-insulation"],
  "windows-glazing": ["glazing"],
  "window-shading": ["glazing"],
  heating: ["heating-cooling", "switchboard"],
  "reverse-cycle-existing": ["heating-cooling", "switchboard"],
  "hot-water": ["hot-water", "switchboard"],
  "heat-pump-hot-water-existing": ["hot-water", "switchboard"],
  cooking: ["cooking", "switchboard"],
  solar: ["roof", "switchboard", "solar"],
  battery: ["solar", "battery", "switchboard"],
  ev: ["switchboard"],
};

const FACT_QUESTIONS = {
  glazing: {
    prompt: "Is the window glazing single, double, mixed or still not known?",
    whyItMatters: "Glazing and frame condition can change whether coverings, shade, sealing or replacement should come first.",
  },
  "ceiling-insulation": {
    prompt: "Do you have safe evidence of ceiling or roof insulation coverage?",
    whyItMatters: "Coverage, condition, moisture and electrical clearances can change the building-shell sequence.",
  },
  "wall-insulation": {
    prompt: "Is wall insulation recorded in plans, invoices or an earlier assessment?",
    whyItMatters: "Wall construction and insulation evidence can change which comfort measure is worth investigating first.",
  },
  "floor-insulation": {
    prompt: "Is underfloor insulation known from safe access or existing records?",
    whyItMatters: "Floor construction and access can change the scope for cold-floor and draught improvements.",
  },
  draughts: {
    prompt: "Do you know where unwanted draughts are felt without blocking required ventilation?",
    whyItMatters: "The location and ventilation purpose determine whether a removable measure or a licensed check comes first.",
  },
  "heating-cooling": {
    prompt: "Is the existing heating and cooling equipment type and condition known?",
    whyItMatters: "Equipment condition, room use and the building shell affect replacement order and sizing questions.",
  },
  "hot-water": {
    prompt: "Is the current hot water system type, location and approximate capacity known?",
    whyItMatters: "Location, clearances, household demand and electrical capacity can change the replacement scope.",
  },
  cooking: {
    prompt: "Is the current cooking fuel and available electrical circuit known?",
    whyItMatters: "Cookware, ventilation, bench dimensions and circuit capacity can change the enabling work.",
  },
  roof: {
    prompt: "Is the roof type and usable condition known from safe records or photos?",
    whyItMatters: "Roof material, shade, condition and access can change solar and insulation planning.",
  },
  switchboard: {
    prompt: "Is the switchboard type known from a safe front-on photo or existing record?",
    whyItMatters: "Electrical capacity and protective devices can change the order and scope of electrification work.",
  },
  solar: {
    prompt: "Is the existing solar system size and inverter model known?",
    whyItMatters: "Existing generation, export limits and daytime use affect whether more solar or storage is useful.",
  },
  battery: {
    prompt: "If a battery is installed, is its usable capacity and backup behaviour known?",
    whyItMatters: "Usable capacity, power and operating mode determine what storage can actually support.",
  },
};

function cleanText(value, maximum) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maximum)
    : "";
}

function cleanIdentifier(value, fallback) {
  const identifier = cleanText(value, 80).toLowerCase();
  return /^[a-z0-9][a-z0-9:_-]{0,79}$/.test(identifier)
    ? identifier
    : fallback;
}

function uniqueBounded(values, maximum = 3) {
  return [...new Set(values.filter(Boolean))].slice(0, maximum);
}

function goalSummary(goalLabels) {
  const labels = uniqueBounded(Array.isArray(goalLabels) ? goalLabels : [], 3);
  return labels.length
    ? `Your selected goals include ${labels.join(", ").toLowerCase()}.`
    : "This step is part of the independent planning sequence.";
}

function guidanceForItem(item, context) {
  const factSources = context.factSources instanceof Map
    ? context.factSources
    : new Map();
  const factLabels = context.factLabels instanceof Map
    ? context.factLabels
    : new Map();
  const relevantFacts = ITEM_FACTS[item.id] || [];
  const knownFacts = relevantFacts
    .filter((factKey) => factSources.get(factKey) && factSources.get(factKey) !== "unknown")
    .map((factKey) => `${factLabels.get(factKey) || factKey} has a source recorded`);
  const unknownFacts = relevantFacts
    .filter((factKey) => !factSources.get(factKey) || factSources.get(factKey) === "unknown")
    .map((factKey) => `${factLabels.get(factKey) || factKey} is still not known`);
  const basedOn = [];
  if (item.id === "evidence-confidence") {
    basedOn.push(
      `${context.knownFactCount || 0} of ${context.factCount || 0} tracked home facts have a source selected.`,
    );
  } else if (item.id === "climate-sequence" && context.climateLabel) {
    basedOn.push(`${context.climateLabel} from the broad postcode and state planning profile.`);
  } else if (item.id === "room-comfort-profile") {
    basedOn.push(
      `${context.roomCount || 0} private room profile${context.roomCount === 1 ? "" : "s"} recorded for sequencing.`,
    );
  } else if (
    item.id === "authority"
    || item.id === "renter-friendly-actions"
  ) {
    basedOn.push(
      context.situation === "renter"
        ? "You recorded that you rent this home."
        : "The property approval context may affect fixed or shared-property work.",
    );
  } else if (item.id.includes("budget") && context.budgetLabel) {
    basedOn.push(`Your private planning range is ${context.budgetLabel.toLowerCase()}.`);
  }
  basedOn.push(...knownFacts, goalSummary(context.goalLabels));

  const stillUncertain = unknownFacts.length
    ? unknownFacts
    : item.id === "climate-sequence"
      ? ["The broad profile does not describe this home's construction, orientation, shade or condition."]
      : item.id === "room-comfort-profile"
        ? ["A room profile records household observations, not measured thermal performance."]
        : ["Site condition, safety, access and the final work scope still need confirmation."];

  const reconsiderIf = item.id === "authority" || item.id === "renter-friendly-actions"
    ? ["Written owner, agent, strata or owners-corporation requirements change."]
    : item.id === "evidence-confidence"
      ? ["A safe photo, document, qualified assessment or site check changes an important home fact."]
      : item.id === "climate-sequence"
        ? ["Room observations or a site-specific assessment show a different main comfort constraint."]
        : item.id.includes("budget")
          ? ["Your available budget or timing changes."]
          : ["New evidence or a licensed site check changes safety, capacity, access or sequencing."];

  return {
    basedOn: uniqueBounded(basedOn, 3),
    stillUncertain: uniqueBounded(stillUncertain, 3),
    reconsiderIf: uniqueBounded(reconsiderIf, 2),
  };
}

export function addPlanDecisionSupport(items = [], context = {}) {
  const factSources = new Map(
    (Array.isArray(context.factEvidence) ? context.factEvidence : [])
      .map((item) => [item?.factKey, item?.source]),
  );
  const factLabels = new Map(
    Array.isArray(context.factLabels) ? context.factLabels : [],
  );
  const knownFactCount = [...factSources.values()]
    .filter((source) => source && source !== "unknown").length;
  const guidanceContext = {
    ...context,
    factSources,
    factLabels,
    knownFactCount,
    factCount: factSources.size,
  };
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    guidance: guidanceForItem(item, guidanceContext),
  }));
}

export function createNextBestQuestions({
  items = [],
  factEvidence = [],
  situation = "",
  approvalContext = "none",
  budgetRange = "not_set",
  roomCount = 0,
  goals = [],
} = {}) {
  const questions = [];
  const add = (question) => {
    if (
      question
      && !questions.some((existing) => existing.id === question.id)
      && questions.length < 3
    ) {
      questions.push({ ...question, notSureAllowed: true });
    }
  };
  if (!situation) {
    add({
      id: "tenure",
      prompt: "Do you own or rent this home?",
      whyItMatters: "Tenure changes which measures can be portable and which may need written permission.",
      targetStep: 1,
      targetAnchor: "customer-situation-owner",
    });
  }
  if (approvalContext === "not_sure") {
    add({
      id: "approval-context",
      prompt: "Could strata, an owners corporation or shared property approval apply?",
      whyItMatters: "Fixed equipment, external shade, solar, glazing and common-property work can require approval before quoting.",
      targetStep: 1,
      targetAnchor: "customer-approval-context",
    });
  }
  if (
    budgetRange === "not_set"
    && (Array.isArray(items) ? items.length : 0) > 4
  ) {
    add({
      id: "budget-range",
      prompt: "Would a broad private budget range help narrow the first stage?",
      whyItMatters: "The range changes sequence and scope only. It is not a price or savings estimate.",
      targetStep: 2,
      targetAnchor: "customer-budget-range",
    });
  }

  const itemIds = new Set(
    (Array.isArray(items) ? items : []).map((item) => item?.id).filter(Boolean),
  );
  const relevantFacts = uniqueBounded(
    [...itemIds].flatMap((itemId) => ITEM_FACTS[itemId] || []),
    12,
  );
  const sources = new Map(
    (Array.isArray(factEvidence) ? factEvidence : [])
      .map((item) => [item?.factKey, item?.source]),
  );
  for (const factKey of relevantFacts) {
    if (questions.length >= 3 || sources.get(factKey) !== "unknown") continue;
    const question = FACT_QUESTIONS[factKey];
    if (!question) continue;
    add({
      id: `fact-${factKey}`,
      ...question,
      targetStep: 2,
      targetAnchor: `advisor-fact-${factKey}`,
    });
  }
  if (
    questions.length < 3
    && Number(roomCount) === 0
    && (Array.isArray(goals) ? goals : []).some((goal) =>
      ["improve-comfort", "healthier-home"].includes(goal))
  ) {
    add({
      id: "room-observation",
      prompt: "Which occupied room is most uncomfortable, and when does it matter?",
      whyItMatters: "A same-room observation can decide whether shade, moisture, draught or insulation investigation comes first.",
      targetStep: 2,
      targetAnchor: "customer-add-room",
    });
  }
  return questions;
}

export function normalizeCustomerReviewItems(value, {
  allowedFactKeys = [],
  allowedPlanItemIds = [],
} = {}) {
  const factKeys = new Set(Array.isArray(allowedFactKeys) ? allowedFactKeys : []);
  const planItemIds = new Set(
    Array.isArray(allowedPlanItemIds) ? allowedPlanItemIds : [],
  );
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .slice(0, 20)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const kind = REVIEW_KINDS.has(item.kind) ? item.kind : "";
      const targetType = REVIEW_TARGET_TYPES.has(item.targetType)
        ? item.targetType
        : "general";
      const text = cleanText(item.text, 500);
      if (!kind || !text) return [];
      let targetId = cleanIdentifier(item.targetId, "");
      if (targetType === "general") targetId = "general";
      if (targetType === "fact" && !factKeys.has(targetId)) return [];
      if (
        targetType === "plan-item"
        && planItemIds.size > 0
        && !planItemIds.has(targetId)
      ) {
        return [];
      }
      if (targetType === "plan-item" && !targetId) return [];
      let id = cleanIdentifier(item.id, `review-${index + 1}`);
      if (seen.has(id)) id = `review-${index + 1}`;
      if (seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        kind,
        targetType,
        targetId,
        text,
        status: REVIEW_STATUSES.has(item.status) ? item.status : "open",
      }];
    });
}

export function privateCustomPlanGuidance() {
  return {
    basedOn: ["A private home-specific step you chose to keep in this plan."],
    stillUncertain: ["This private wording has not been assessed or verified."],
    reconsiderIf: ["New evidence or your priorities change."],
  };
}
