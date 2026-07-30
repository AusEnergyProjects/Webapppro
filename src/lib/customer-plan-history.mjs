import {
  compareCustomerPlanRevisions,
  customerPlanRevisionProjection,
} from "./customer-plan-revisions.mjs";

const MAX_SELECTED_REVISIONS = 12;
const MAX_SELECTED_OUTCOMES = 24;
const MAX_COMPLETED_ITEMS = 40;
const MAX_NOTE_LENGTH = 500;

const COMFORT_OUTCOME_OPTIONS = [
  ["better", "More comfortable"],
  ["about-the-same", "About the same"],
  ["worse", "Less comfortable"],
  ["not-sure", "Not sure yet"],
];

const ENERGY_OUTCOME_OPTIONS = [
  ["lower", "Energy use or bills look lower"],
  ["about-the-same", "About the same"],
  ["higher", "Energy use or bills look higher"],
  ["not-checked", "Not checked or not comparable"],
];

const REVISION_EVENT_LABELS = new Map([
  ["baseline", "Starting roadmap"],
  ["saved", "Roadmap updated"],
  ["restored", "Earlier roadmap restored"],
  ["duplicated", "Roadmap copied"],
]);

const REVISION_EVENT_TYPES = new Set(REVISION_EVENT_LABELS.keys());
const COMFORT_OUTCOMES = new Set(
  COMFORT_OUTCOME_OPTIONS.map(([value]) => value),
);
const ENERGY_OUTCOMES = new Set(
  ENERGY_OUTCOME_OPTIONS.map(([value]) => value),
);

export const customerOutcomeOptions = {
  comfort: COMFORT_OUTCOME_OPTIONS,
  energy: ENERGY_OUTCOME_OPTIONS,
};

function boundedText(value, maximum) {
  return typeof value === "string"
    ? Array.from(value.trim()).slice(0, maximum).join("")
    : "";
}

function boundedInteger(value, maximum = 1_000_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum
    ? number
    : 0;
}

function boundedList(value, maximum, itemMaximum = 120) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const normalised = boundedText(item, itemMaximum);
    if (!normalised || seen.has(normalised) || seen.size >= maximum) return [];
    seen.add(normalised);
    return [normalised];
  });
}

function optionLabel(options, value) {
  const safeValue = boundedText(value, 120);
  const safeOptions = Array.isArray(options) ? options : [];
  const match = safeOptions.find(
    (option) => Array.isArray(option) && option[0] === safeValue,
  );
  return boundedText(match?.[1], 160)
    || safeValue.replaceAll("-", " ").replaceAll("_", " ");
}

function knownEventType(value) {
  const eventType = boundedText(value, 40);
  return REVISION_EVENT_TYPES.has(eventType) ? eventType : "saved";
}

function revisionRecord(value) {
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    ...customerPlanRevisionProjection(supplied),
    id: boundedText(supplied.id, 180),
    eventType: knownEventType(supplied.eventType),
    restoredFromRevision: boundedInteger(supplied.restoredFromRevision),
    createdAt: boundedText(supplied.createdAt, 40),
  };
}

function outcomeRecord(value) {
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const comfortOutcome = boundedText(supplied.comfortOutcome, 40);
  const energyOutcome = boundedText(supplied.energyOutcome, 40);
  return {
    id: boundedText(supplied.id, 180),
    comfortOutcome: COMFORT_OUTCOMES.has(comfortOutcome)
      ? comfortOutcome
      : "not-sure",
    energyOutcome: ENERGY_OUTCOMES.has(energyOutcome)
      ? energyOutcome
      : "not-checked",
    completedItemIds: boundedList(
      supplied.completedItemIds,
      MAX_COMPLETED_ITEMS,
      80,
    ),
    note: boundedText(supplied.note, MAX_NOTE_LENGTH),
    recordedAt: boundedText(supplied.recordedAt, 40),
  };
}

export function customerPlanRevisionLabel(value) {
  const revision = revisionRecord(value);
  return REVISION_EVENT_LABELS.get(revision.eventType)
    || REVISION_EVENT_LABELS.get("saved");
}

export function normalizeCustomerOutcomeInput(value) {
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const comfortOutcome = boundedText(supplied.comfortOutcome, 40);
  const energyOutcome = boundedText(supplied.energyOutcome, 40);
  if (
    !COMFORT_OUTCOMES.has(comfortOutcome)
    || !ENERGY_OUTCOMES.has(energyOutcome)
  ) {
    return {
      ok: false,
      error: "Choose valid comfort and energy-use observations.",
    };
  }
  return {
    ok: true,
    outcome: {
      comfortOutcome,
      energyOutcome,
      note: boundedText(supplied.note, MAX_NOTE_LENGTH),
    },
  };
}

export function compareCustomerOutcomeCheckins(fromValue, toValue) {
  const from = outcomeRecord(fromValue);
  const to = outcomeRecord(toValue);
  const fromCompleted = new Set(from.completedItemIds);
  const toCompleted = new Set(to.completedItemIds);
  const addedItemIds = [...toCompleted].filter((id) => !fromCompleted.has(id));
  const removedItemIds = [...fromCompleted].filter((id) => !toCompleted.has(id));
  return {
    fromId: from.id,
    toId: to.id,
    fromRecordedAt: from.recordedAt,
    toRecordedAt: to.recordedAt,
    comfort: {
      changed: from.comfortOutcome !== to.comfortOutcome,
      from: from.comfortOutcome,
      to: to.comfortOutcome,
    },
    energy: {
      changed: from.energyOutcome !== to.energyOutcome,
      from: from.energyOutcome,
      to: to.energyOutcome,
    },
    completedSteps: {
      fromCount: fromCompleted.size,
      toCount: toCompleted.size,
      addedCount: addedItemIds.length,
      removedCount: removedItemIds.length,
      addedItemIds,
      removedItemIds,
    },
  };
}

function selectedRevisions(revisions, revisionNumbers) {
  const selected = new Set(
    (Array.isArray(revisionNumbers) ? revisionNumbers : [])
      .slice(0, MAX_SELECTED_REVISIONS)
      .map((value) => boundedInteger(value))
      .filter(Boolean),
  );
  return (Array.isArray(revisions) ? revisions : [])
    .map(revisionRecord)
    .filter((revision) => selected.has(revision.revisionNumber))
    .sort((left, right) => left.revisionNumber - right.revisionNumber)
    .slice(0, MAX_SELECTED_REVISIONS);
}

function selectedOutcomes(outcomes, outcomeIds) {
  const selected = new Set(
    boundedList(outcomeIds, MAX_SELECTED_OUTCOMES, 180),
  );
  return (Array.isArray(outcomes) ? outcomes : [])
    .map(outcomeRecord)
    .filter((outcome) => selected.has(outcome.id))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
    .slice(0, MAX_SELECTED_OUTCOMES);
}

function safeRevisionComparison(from, to, labels) {
  const comparison = compareCustomerPlanRevisions(from, to);
  return {
    earlierRevision: from.revisionNumber,
    laterRevision: to.revisionNumber,
    totalChanges: comparison.changeCount,
    goals: {
      added: comparison.goals.added.map((value) =>
        optionLabel(labels.goals, value)
      ),
      removed: comparison.goals.removed.map((value) =>
        optionLabel(labels.goals, value)
      ),
    },
    homeDetails: {
      added: comparison.homeFeatures.added.map((value) =>
        optionLabel(labels.homeFeatures, value)
      ),
      removed: comparison.homeFeatures.removed.map((value) =>
        optionLabel(labels.homeFeatures, value)
      ),
    },
    planningPace: {
      changed: comparison.pace.changed,
      from: optionLabel(labels.paces, comparison.pace.from),
      to: optionLabel(labels.paces, comparison.pace.to),
    },
    budgetRange: {
      changed: comparison.budgetRange.changed,
      from: optionLabel(labels.budgets, comparison.budgetRange.from),
      to: optionLabel(labels.budgets, comparison.budgetRange.to),
    },
    propertyContextChanged: comparison.propertyContext.changed,
    workCategories: {
      added: comparison.serviceCategories.added.map((value) =>
        optionLabel(labels.serviceCategories, value)
      ),
      removed: comparison.serviceCategories.removed.map((value) =>
        optionLabel(labels.serviceCategories, value)
      ),
    },
    advisorPlanChanged: comparison.planVersion.changed,
    orderedSteps: {
      earlierCount: from.planSnapshot.items.length,
      laterCount: to.planSnapshot.items.length,
      addedCount: comparison.steps.added.length,
      removedCount: comparison.steps.removed.length,
      movedCount: comparison.steps.moved.length,
      wordingChangedCount: comparison.steps.modified.length,
    },
  };
}

function safeOutcomeComparison(from, to) {
  const comparison = compareCustomerOutcomeCheckins(from, to);
  return {
    earlierRecordedAt: comparison.fromRecordedAt,
    laterRecordedAt: comparison.toRecordedAt,
    comfort: {
      changed: comparison.comfort.changed,
      from: optionLabel(COMFORT_OUTCOME_OPTIONS, comparison.comfort.from),
      to: optionLabel(COMFORT_OUTCOME_OPTIONS, comparison.comfort.to),
    },
    energyUseOrBills: {
      changed: comparison.energy.changed,
      from: optionLabel(ENERGY_OUTCOME_OPTIONS, comparison.energy.from),
      to: optionLabel(ENERGY_OUTCOME_OPTIONS, comparison.energy.to),
    },
    completedSteps: {
      fromCount: comparison.completedSteps.fromCount,
      toCount: comparison.completedSteps.toCount,
      addedCount: comparison.completedSteps.addedCount,
      removedCount: comparison.completedSteps.removedCount,
    },
  };
}

export function buildCustomerPlanHistoryExport({
  revisions,
  selectedRevisionNumbers,
  outcomes,
  selectedOutcomeIds,
  labels = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const safeLabels = {
    goals: Array.isArray(labels.goals) ? labels.goals : [],
    homeFeatures: Array.isArray(labels.homeFeatures)
      ? labels.homeFeatures
      : [],
    paces: Array.isArray(labels.paces) ? labels.paces : [],
    budgets: Array.isArray(labels.budgets) ? labels.budgets : [],
    serviceCategories: Array.isArray(labels.serviceCategories)
      ? labels.serviceCategories
      : [],
  };
  const revisionSelection = selectedRevisions(
    revisions,
    selectedRevisionNumbers,
  );
  const outcomeSelection = selectedOutcomes(outcomes, selectedOutcomeIds);
  const revisionRows = revisionSelection.map((revision) => ({
    revisionNumber: revision.revisionNumber,
    label: customerPlanRevisionLabel(revision),
    recordedAt: revision.createdAt,
    restoredFromRevision: revision.restoredFromRevision || null,
    goals: revision.goals.map((value) =>
      optionLabel(safeLabels.goals, value)
    ),
    homeDetails: revision.homeFeatures.map((value) =>
      optionLabel(safeLabels.homeFeatures, value)
    ),
    planningPace: optionLabel(safeLabels.paces, revision.pace),
    budgetRange: optionLabel(safeLabels.budgets, revision.budgetRange),
    orderedStepCount: revision.planSnapshot.items.length,
  }));
  const outcomeRows = outcomeSelection.map((outcome, index) => ({
    label: `Progress check-in ${index + 1}`,
    recordedAt: outcome.recordedAt,
    comfort: optionLabel(COMFORT_OUTCOME_OPTIONS, outcome.comfortOutcome),
    energyUseOrBills: optionLabel(
      ENERGY_OUTCOME_OPTIONS,
      outcome.energyOutcome,
    ),
    completedStepCount: outcome.completedItemIds.length,
  }));
  return {
    exportVersion: 1,
    generatedAt: boundedText(generatedAt, 40),
    title: "Home energy plan history",
    privacyNotice:
      "This shareable summary excludes exact addresses, private room names, evidence filenames, private notes and custom roadmap wording.",
    interpretationNotice:
      "Progress entries are household observations. They do not prove that a roadmap step caused a change or guarantee energy or bill savings.",
    revisions: revisionRows,
    revisionComparison: revisionSelection.length === 2
      ? safeRevisionComparison(
          revisionSelection[0],
          revisionSelection[1],
          safeLabels,
        )
      : null,
    progressCheckins: outcomeRows,
    progressComparison: outcomeSelection.length === 2
      ? safeOutcomeComparison(outcomeSelection[0], outcomeSelection[1])
      : null,
  };
}

export function serialiseCustomerPlanHistoryExport(input) {
  return `${JSON.stringify(buildCustomerPlanHistoryExport(input), null, 2)}\n`;
}
