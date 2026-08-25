import {
  SURGE_PROFILE_FIELDS,
  surgeProfileReviewedAnswerCount,
  type SurgeStarterProfile,
} from "./surge-assessor-profile.ts";
import {
  SURGE_REVIEWED_GUIDANCE,
  type ReviewedSurgeGuidance,
} from "../data/surge-reviewed-guidance.ts";

export type HomeContextTip = Omit<ReviewedSurgeGuidance, "effectiveFrom" | "effectiveTo">;

type RankedTip = HomeContextTip & {
  priority: number;
};

export type HomeContextTipsOptions = {
  asOf?: Date | string;
  guidance?: readonly ReviewedSurgeGuidance[];
};

const hasAny = (profile: SurgeStarterProfile, values: readonly string[]) =>
  values.some((value) => profile.features.includes(value));

const reviewed = (profile: SurgeStarterProfile, fieldId: string) =>
  profile.reviewed.includes(fieldId);

function isoDay(value: Date | string) {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(parsed.getTime())) throw new Error("A valid guidance date is required.");
  return parsed.toISOString().slice(0, 10);
}

function currentGuidance(
  guidance: readonly ReviewedSurgeGuidance[],
  asOf: string,
) {
  return new Map(guidance
    .filter((item) => item.effectiveFrom <= asOf
      && (!item.effectiveTo || item.effectiveTo >= asOf)
      && item.reviewedOn <= asOf
      && item.reviewDue >= asOf
      && item.sourceIds.length > 0
      && item.jurisdictions.length > 0)
    .map((item) => [item.id, item]));
}

/**
 * Build a fresh, deterministic guidance rail from the latest saved profile.
 * Rules only select reviewed registry records. A missing or expired record is
 * removed and lower-ranked reviewed guidance takes its place.
 */
export function homeContextTips(profile: SurgeStarterProfile): HomeContextTip[];
export function homeContextTips(
  profile: SurgeStarterProfile,
  options: HomeContextTipsOptions,
): HomeContextTip[];
export function homeContextTips(
  profile: SurgeStarterProfile,
  options: HomeContextTipsOptions = {},
): HomeContextTip[] {
  const asOf = isoDay(options.asOf || new Date());
  const guidance = currentGuidance(options.guidance || SURGE_REVIEWED_GUIDANCE, asOf);
  const tips: RankedTip[] = [];
  const add = (priority: number, id: string) => {
    const item = guidance.get(id);
    if (!item || tips.some((tip) => tip.id === id || tip.title === item.title)) return;
    const { effectiveFrom, effectiveTo, ...tip } = item;
    void effectiveFrom;
    void effectiveTo;
    tips.push({ priority, ...tip });
  };

  if (surgeProfileReviewedAnswerCount(profile) < SURGE_PROFILE_FIELDS.length) {
    add(100, "missing-context");
  }

  const moistureReported = reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("condensation-moisture");
  const draughtsReported = reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("draughty");

  if (
    reviewed(profile, "feature:ceiling-insulation")
    && hasAny(profile, ["ceiling-insulation-none", "ceiling-insulation-limited"])
  ) {
    add(94, moistureReported ? "ceiling-moisture-first" : "ceiling-topup-first");
  }

  if (moistureReported) add(92, "moisture-before-sealing");
  else if (draughtsReported) add(91, "easy-draughts");

  if (
    reviewed(profile, "feature:heating-cooling-systems")
    && profile.features.includes("electric-resistance-heating")
  ) add(90, "avoid-portable-heaters");

  if (
    reviewed(profile, "feature:heating-cooling-systems")
    && profile.features.includes("reverse-cycle")
    && profile.features.includes("gas-heating")
  ) add(89, "rcac-before-gas");

  if (
    reviewed(profile, "feature:ventilation-features")
    && profile.features.includes("evaporative-ducts")
  ) add(88, "evaporative-outlets");

  if (
    reviewed(profile, "feature:glazing")
    && hasAny(profile, ["single-glazing", "mixed-glazing"])
  ) {
    const weakCoverings = reviewed(profile, "feature:window-coverings")
      && hasAny(profile, ["window-coverings-none", "window-coverings-basic", "window-coverings-mixed"]);
    const weakShade = reviewed(profile, "feature:external-shading")
      && profile.features.includes("external-shading-none");
    add(87, weakCoverings || weakShade ? "windows-basic-measures" : "windows-seals-film");
  }

  if (
    reviewed(profile, "feature:external-shading")
    && profile.features.includes("external-shading-none")
    && reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("comfort-too-hot")
  ) add(86, "shade-hot-windows");

  if (reviewed(profile, "feature:solar") && profile.features.includes("solar")) {
    add(85, "solar-load-shift");
  }

  if (
    reviewed(profile, "supplemental:billPressure")
    && (profile.billPressure === "higher-than-expected" || profile.billPressure === "hard-to-manage")
  ) add(78, "tariff-load-shift");

  if (reviewed(profile, "supplemental:gasConnection") && profile.gasConnection === "connected") {
    add(74, "mains-gas-sequence");
  }
  if (reviewed(profile, "supplemental:gasConnection") && profile.gasConnection === "bottled-lpg") {
    add(74, "lpg-sequence");
  }

  if (
    reviewed(profile, "supplemental:plannedWorks")
    && (profile.plannedWorks === "renovation" || profile.plannedWorks === "new-build")
  ) add(72, "planned-work");

  if (tips.length === 0) add(1, "context-ready");

  return tips
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, 3)
    .map(({ priority, ...tip }) => {
      void priority;
      return tip;
    });
}
