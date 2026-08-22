import {
  SURGE_PROFILE_FIELDS,
  surgeProfileReviewedAnswerCount,
  type SurgeStarterProfile,
} from "./surge-assessor-profile.ts";

export type HomeContextTip = {
  title: string;
  detail: string;
};

type RankedTip = HomeContextTip & {
  priority: number;
};

const hasAny = (profile: SurgeStarterProfile, values: readonly string[]) =>
  values.some((value) => profile.features.includes(value));

const reviewed = (profile: SurgeStarterProfile, fieldId: string) =>
  profile.reviewed.includes(fieldId);

/**
 * Build a fresh, deterministic guidance rail from the latest saved profile.
 * Each rule is deliberately tied to a reviewed answer so outdated or inferred
 * concerns cannot survive after the customer changes that answer.
 */
export function homeContextTips(profile: SurgeStarterProfile): HomeContextTip[] {
  const tips: RankedTip[] = [];
  const add = (priority: number, title: string, detail: string) => {
    if (!tips.some((tip) => tip.title === title)) tips.push({ priority, title, detail });
  };

  if (surgeProfileReviewedAnswerCount(profile) < SURGE_PROFILE_FIELDS.length) {
    add(
      100,
      "Finish the missing context",
      "Resume at the next unanswered section so Surge AI can use the complete home picture.",
    );
  }

  const moistureReported = reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("condensation-moisture");
  const draughtsReported = reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("draughty");

  if (
    reviewed(profile, "feature:ceiling-insulation")
    && hasAny(profile, ["ceiling-insulation-none", "ceiling-insulation-limited"])
  ) {
    add(
      94,
      "Check the ceiling first",
      moistureReported
        ? "Check the cause of damp, confirm safe clearances and verify continuous insulation coverage before sizing new equipment."
        : "Confirm safe clearances and continuous insulation coverage before sizing new heating or cooling equipment.",
    );
  }

  if (moistureReported) {
    add(
      92,
      "Investigate moisture before sealing",
      "Find the condensation, damp or mould source first, then improve air sealing while keeping required ventilation working.",
    );
  } else if (draughtsReported) {
    add(
      89,
      "Target the largest draughts",
      "Start with obvious gaps around doors, windows and floor edges, while leaving required vents and exhaust paths working.",
    );
  }

  if (
    reviewed(profile, "feature:comfort-concerns")
    && hasAny(profile, ["comfort-too-hot", "comfort-too-cold"])
  ) {
    const seasonalProblem = hasAny(profile, ["comfort-too-hot", "comfort-too-cold"])
      ? hasAny(profile, ["comfort-too-hot"]) && hasAny(profile, ["comfort-too-cold"])
        ? "summer heat and winter cold"
        : profile.features.includes("comfort-too-hot")
          ? "summer heat"
          : "winter cold"
      : "comfort";
    add(
      85,
      "Fix the shell before upsizing equipment",
      `Reduce ${seasonalProblem} through insulation, shade and air leakage checks before choosing larger heating or cooling systems.`,
    );
  }

  if (
    reviewed(profile, "feature:glazing")
    && hasAny(profile, ["single-glazing", "mixed-glazing"])
  ) {
    const weakCoverings = reviewed(profile, "feature:window-coverings")
      && hasAny(profile, ["window-coverings-none", "window-coverings-basic", "window-coverings-mixed"]);
    const weakShade = reviewed(profile, "feature:external-shading")
      && profile.features.includes("external-shading-none");
    add(
      81,
      "Improve windows in stages",
      weakCoverings || weakShade
        ? "Start with seals, close-fitting coverings and external shade before deciding whether full glazing replacement is worthwhile."
        : "Check seals and room-by-room comfort before deciding whether full glazing replacement is worthwhile.",
    );
  }

  if (
    reviewed(profile, "supplemental:billPressure")
    && (profile.billPressure === "higher-than-expected" || profile.billPressure === "hard-to-manage")
  ) {
    add(
      78,
      "Use bills to verify the first move",
      "Compare seasonal usage before and after low-cost shell improvements so the next upgrade targets the largest remaining load.",
    );
  }

  if (reviewed(profile, "supplemental:gasConnection") && profile.gasConnection === "connected") {
    add(
      74,
      "Sequence mains gas replacement carefully",
      "Reduce demand first, then confirm electrical capacity before replacing major mains gas appliances.",
    );
  }

  if (reviewed(profile, "supplemental:gasConnection") && profile.gasConnection === "bottled-lpg") {
    add(
      74,
      "Plan around bottled gas use",
      "Identify which appliances use LPG, then compare staged electric replacements after checking switchboard capacity.",
    );
  }

  if (
    reviewed(profile, "supplemental:plannedWorks")
    && (profile.plannedWorks === "renovation" || profile.plannedWorks === "new-build")
  ) {
    add(
      72,
      "Coordinate upgrades with planned building work",
      "Use the planned works to improve access, insulation continuity and electrical capacity before finishes are closed up.",
    );
  }

  if (tips.length === 0) {
    add(
      1,
      "Your context is ready",
      "Ask Surge AI what to prioritise and it will use the confirmed details saved in this browser.",
    );
  }

  return tips
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 3)
    .map(({ title, detail }) => ({ title, detail }));
}
