import { HOME_ENERGY_ASSESSMENT_STORAGE_KEY } from "./home-energy-assessment-storage.ts";
import {
  homeEnergyPlannerCompletion,
  parseHomeEnergyPlannerSession,
  type HomeEnergyPlannerDraft,
} from "./home-energy-planner-schema.ts";

export type PlannerComparisonTarget = "electricity" | "gas";
export const PLANNER_COMPARISON_INTENT_KEY = "aea-planner-comparison-intent-v1";
export const PLANNER_COMPARISON_MAX_AGE_MS = 15 * 60 * 1000;

type ReadStorage = Pick<Storage, "getItem">;
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlannerComparisonStorage = { local: ReadStorage; tab: TabStorage };

export type PlannerGasEquipment = {
  heating: string[];
  hotWater: string;
  gasCooking?: boolean;
  people: string;
};

export type PlannerComparisonHandoff = {
  postcode: string;
  electricitySetup?: "none" | "solar" | "battery";
  gasSupply?: "mains" | "lpg";
  gasEquipment: PlannerGasEquipment;
};

// This is a local change detector, not an identity or authorization credential.
function sessionFingerprint(serialized: string): string {
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
  }
  return `${serialized.length}:${hash >>> 0}`;
}

function confirmedSession(serialized: string) {
  const session = parseHomeEnergyPlannerSession(serialized);
  return session?.stage === 4 && homeEnergyPlannerCompletion(session.draft).ready ? session : null;
}

export function createPlannerComparisonIntent(serializedSession: string, target: PlannerComparisonTarget, now = Date.now()): string | null {
  if (!confirmedSession(serializedSession) || !Number.isFinite(now)) return null;
  return JSON.stringify({ version: 1, target, createdAt: now, fingerprint: sessionFingerprint(serializedSession) });
}

export function mapPlannerComparisonFacts(draft: HomeEnergyPlannerDraft): PlannerComparisonHandoff {
  const features = new Set(draft.features);
  let electricitySetup: PlannerComparisonHandoff["electricitySetup"];
  if (features.has("solar-none") && features.has("battery-none")) electricitySetup = "none";
  if (features.has("solar") && features.has("battery-none")) electricitySetup = "solar";
  if (features.has("solar") && features.has("battery")) electricitySetup = "battery";

  const heating: string[] = [];
  if (features.has("gas-heating")) heating.push("gas-unspecified");
  if (features.has("wood-heating") || features.has("electric-resistance-heating")) heating.push("other");
  const hotWaterMappings: Record<string, string> = {
    "gas-storage-hot-water": "gas-storage",
    "gas-continuous-flow-hot-water": "gas-instant",
    "heat-pump-hot-water": "heat-pump",
    "electric-storage-hot-water": "electric",
    "electric-instant-hot-water": "electric",
    "hot-water-other": "other",
  };
  const hotWater = Object.entries(hotWaterMappings).find(([feature]) => features.has(feature))?.[1] ?? "";
  const gasCooking = features.has("gas-cooking") || features.has("mixed-cooking") ? true
    : features.has("electric-resistance-cooking") || features.has("induction-cooking") ? false : undefined;
  const gasSupply = draft.gasConnection === "connected" || draft.gasConnection === "disconnecting" ? "mains"
    : draft.gasConnection === "bottled-lpg" ? "lpg" : undefined;
  return {
    postcode: draft.postcode,
    electricitySetup,
    gasSupply,
    gasEquipment: { heating, hotWater, gasCooking, people: draft.occupants === "one" ? "1" : draft.occupants === "two" ? "2" : "" },
  };
}

/** Only an intentional, fresh navigation in this tab can reuse the canonical draft. */
export function readPlannerComparisonHandoff(search: string, target: PlannerComparisonTarget, storage: PlannerComparisonStorage, now = Date.now()): PlannerComparisonHandoff | null {
  const query = new URLSearchParams(search);
  if (query.get("from") !== "home-plan" && query.get("source") !== "home-plan") return null;
  if (target === "electricity" && query.get("cust") === "BUSINESS") return null;
  try {
    const intentValue = storage.tab.getItem(PLANNER_COMPARISON_INTENT_KEY);
    if (!intentValue) return null;
    const intent: unknown = JSON.parse(intentValue);
    if (!intent || typeof intent !== "object" || !("version" in intent) || intent.version !== 1
      || !("target" in intent) || intent.target !== target || !("createdAt" in intent)
      || typeof intent.createdAt !== "number" || !Number.isFinite(intent.createdAt)
      || !Number.isFinite(now) || now < intent.createdAt || now - intent.createdAt > PLANNER_COMPARISON_MAX_AGE_MS
      || !("fingerprint" in intent) || typeof intent.fingerprint !== "string") return null;
    // Mirror the planner's local-first storage contract, including its tab fallback.
    let localSession: string | null = null;
    try { localSession = storage.local.getItem(HOME_ENERGY_ASSESSMENT_STORAGE_KEY); } catch { /* The planner also supports unavailable local storage. */ }
    const serialized = localSession || storage.tab.getItem(HOME_ENERGY_ASSESSMENT_STORAGE_KEY);
    if (!serialized || sessionFingerprint(serialized) !== intent.fingerprint) return null;
    const session = confirmedSession(serialized);
    if (!session) return null;
    const explicitPostcode = query.get("pc") || query.get("postcode");
    if (explicitPostcode && explicitPostcode !== session.draft.postcode) return null;
    storage.tab.removeItem(PLANNER_COMPARISON_INTENT_KEY);
    return mapPlannerComparisonFacts(session.draft);
  } catch {
    return null;
  }
}
