import {
  customerProjectOptions,
  normalizeCustomerProject,
  reconcileCompletedPlanItems,
} from "./customer-projects.mjs";

const MAX_GOALS = 10;
const MAX_HOME_FEATURES = 40;
const MAX_SERVICE_CATEGORIES = 12;
const MAX_PLAN_ITEMS = 40;
const ROADMAP_PROPERTY_KEYS = [
  "storeys",
  "ageBand",
  "floorArea",
  "roofType",
  "switchboard",
];
const REVISION_SERVICE_CATEGORIES = new Set([
  ...customerProjectOptions.serviceCategories.map(([value]) => value),
  "insulation-draughts",
]);

function boundedText(value, maximum) {
  return typeof value === "string"
    ? Array.from(value.trim()).slice(0, maximum).join("")
    : "";
}

function boundedList(value, maximum, itemMaximum = 120) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const normalized = boundedText(item, itemMaximum);
    if (!normalized || seen.has(normalized) || seen.size >= maximum) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function planItemProjection(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = boundedText(value.id, 80);
  if (!/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(id)) return null;
  return {
    id,
    position: index + 1,
    stage: boundedText(value.stage, 100),
    title: boundedText(value.title, 180),
    text: boundedText(value.text || value.description, 900),
  };
}

function planItems(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, MAX_PLAN_ITEMS).flatMap((item, index) => {
    const projected = planItemProjection(item, index);
    if (!projected || seen.has(projected.id)) return [];
    seen.add(projected.id);
    return [projected];
  }).map((item, index) => ({ ...item, position: index + 1 }));
}

function propertyContextProjection(value) {
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(
    ROADMAP_PROPERTY_KEYS.map((key) => [key, boundedText(supplied[key], 40)]),
  );
}

export function customerPlanRevisionProjection(value = {}) {
  const supplied = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const snapshot = supplied.planSnapshot
    && typeof supplied.planSnapshot === "object"
    && !Array.isArray(supplied.planSnapshot)
    ? supplied.planSnapshot
    : {};
  const hasRoadmapInputs = Boolean(
    snapshot.propertyContext
    && typeof snapshot.propertyContext === "object"
    && !Array.isArray(snapshot.propertyContext)
    && Array.isArray(snapshot.serviceCategories),
  );
  return {
    revisionNumber: Number.isInteger(Number(supplied.revisionNumber))
      ? Math.max(0, Number(supplied.revisionNumber))
      : 0,
    planVersion: boundedText(
      supplied.planVersion || snapshot.version,
      80,
    ),
    goals: boundedList(supplied.goals, MAX_GOALS, 80),
    homeFeatures: boundedList(
      supplied.homeFeatures || supplied.existingFeatures,
      MAX_HOME_FEATURES,
      80,
    ),
    pace: boundedText(supplied.pace, 40),
    budgetRange: boundedText(supplied.budgetRange, 40),
    hasRoadmapInputs,
    propertyContext: propertyContextProjection(snapshot.propertyContext),
    serviceCategories: boundedList(
      snapshot.serviceCategories,
      MAX_SERVICE_CATEGORIES,
      80,
    ).filter((value) => REVISION_SERVICE_CATEGORIES.has(value)),
    planSnapshot: {
      version: boundedText(snapshot.version, 80),
      items: planItems(snapshot.items),
    },
  };
}

function listDifference(source, comparison) {
  const comparisonSet = new Set(comparison);
  return source.filter((item) => !comparisonSet.has(item));
}

function stepComparable(item) {
  return {
    stage: item.stage,
    title: item.title,
    text: item.text,
  };
}

function sameStepContent(left, right) {
  return left.stage === right.stage
    && left.title === right.title
    && left.text === right.text;
}

export function compareCustomerPlanRevisions(fromValue, toValue) {
  const from = customerPlanRevisionProjection(fromValue);
  const to = customerPlanRevisionProjection(toValue);
  const fromItems = new Map(
    from.planSnapshot.items.map((item) => [item.id, item]),
  );
  const toItems = new Map(
    to.planSnapshot.items.map((item) => [item.id, item]),
  );
  const added = to.planSnapshot.items
    .filter((item) => !fromItems.has(item.id));
  const removed = from.planSnapshot.items
    .filter((item) => !toItems.has(item.id));
  const moved = to.planSnapshot.items.flatMap((item) => {
    const previous = fromItems.get(item.id);
    if (!previous || previous.position === item.position) return [];
    return [{
      id: item.id,
      title: item.title,
      fromPosition: previous.position,
      toPosition: item.position,
    }];
  });
  const modified = to.planSnapshot.items.flatMap((item) => {
    const previous = fromItems.get(item.id);
    if (!previous || sameStepContent(previous, item)) return [];
    return [{
      id: item.id,
      before: stepComparable(previous),
      after: stepComparable(item),
    }];
  });
  const result = {
    fromRevisionNumber: from.revisionNumber,
    toRevisionNumber: to.revisionNumber,
    goals: {
      added: listDifference(to.goals, from.goals),
      removed: listDifference(from.goals, to.goals),
    },
    homeFeatures: {
      added: listDifference(to.homeFeatures, from.homeFeatures),
      removed: listDifference(from.homeFeatures, to.homeFeatures),
    },
    pace: {
      changed: from.pace !== to.pace,
      from: from.pace,
      to: to.pace,
    },
    budgetRange: {
      changed: from.budgetRange !== to.budgetRange,
      from: from.budgetRange,
      to: to.budgetRange,
    },
    propertyContext: {
      changed:
        JSON.stringify(from.propertyContext)
        !== JSON.stringify(to.propertyContext),
      from: from.propertyContext,
      to: to.propertyContext,
    },
    serviceCategories: {
      added: listDifference(
        to.serviceCategories,
        from.serviceCategories,
      ),
      removed: listDifference(
        from.serviceCategories,
        to.serviceCategories,
      ),
    },
    planVersion: {
      changed: from.planVersion !== to.planVersion,
      from: from.planVersion,
      to: to.planVersion,
    },
    steps: { added, removed, moved, modified },
  };
  return {
    ...result,
    changeCount:
      result.goals.added.length
      + result.goals.removed.length
      + result.homeFeatures.added.length
      + result.homeFeatures.removed.length
      + Number(result.pace.changed)
      + Number(result.budgetRange.changed)
      + Number(result.propertyContext.changed)
      + result.serviceCategories.added.length
      + result.serviceCategories.removed.length
      + Number(result.planVersion.changed)
      + result.steps.added.length
      + result.steps.removed.length
      + result.steps.moved.length
      + result.steps.modified.length,
  };
}

export function prepareCustomerPlanRevisionRestore(
  currentProject,
  storedRevision,
) {
  const unsafe = () => ({
    ok: false,
    error:
      "This saved version can no longer be restored safely. Keep the current plan or choose another version.",
  });
  const suppliedSnapshot = storedRevision?.planSnapshot;
  if (
    !storedRevision
    || typeof storedRevision !== "object"
    || Array.isArray(storedRevision)
    || !Number.isSafeInteger(storedRevision.revisionNumber)
    || !Array.isArray(storedRevision.goals)
    || !Array.isArray(storedRevision.homeFeatures)
    || typeof storedRevision.pace !== "string"
    || typeof storedRevision.budgetRange !== "string"
    || typeof storedRevision.planVersion !== "string"
    || !suppliedSnapshot
    || typeof suppliedSnapshot !== "object"
    || Array.isArray(suppliedSnapshot)
    || !Array.isArray(suppliedSnapshot.items)
    || typeof suppliedSnapshot.version !== "string"
  ) {
    return unsafe();
  }
  const revision = customerPlanRevisionProjection(storedRevision);
  if (revision.revisionNumber < 1) {
    return {
      ok: false,
      error: "Choose a valid saved plan version.",
    };
  }
  if (
    !revision.planVersion
    || revision.planVersion !== revision.planSnapshot.version
  ) {
    return unsafe();
  }
  const normalized = normalizeCustomerProject({
    ...currentProject,
    goals: revision.goals,
    existingFeatures: revision.homeFeatures,
    pace: revision.pace,
    budgetRange: revision.budgetRange,
    propertyContext: revision.hasRoadmapInputs
      ? {
          ...(currentProject?.propertyContext || {}),
          ...revision.propertyContext,
        }
      : currentProject?.propertyContext,
    serviceCategories: revision.hasRoadmapInputs
      ? revision.serviceCategories
      : currentProject?.serviceCategories,
    planSnapshot: storedRevision?.planSnapshot,
  });
  if (!normalized.ok || !normalized.project) {
    return unsafe();
  }
  return {
    ok: true,
    project: normalized.project,
    completedPlanItems: reconcileCompletedPlanItems(
      currentProject?.completedPlanItems,
      normalized.project.planSnapshot,
    ),
  };
}
