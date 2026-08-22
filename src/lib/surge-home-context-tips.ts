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
        ? "Find the moisture source first, then have insulation coverage, gaps and safe clearances checked before topping it up."
        : "Have insulation coverage, gaps and safe clearances checked, then top it up before paying for larger heating or cooling equipment.",
    );
  }

  if (moistureReported) {
    add(
      92,
      "Control moisture before sealing",
      "Use exhaust fans, short purposeful airing or a dehumidifier when needed, and find any leak before sealing draughts. Keep required ventilation working.",
    );
  } else if (draughtsReported) {
    add(
      91,
      "Stop the easy draughts first",
      "Try a door snake and removable door or window seals first. Use suitable sealant only on confirmed fixed gaps, never required vents, exhausts, chimneys or flues.",
    );
  }

  if (
    reviewed(profile, "feature:heating-cooling-systems")
    && profile.features.includes("electric-resistance-heating")
  ) {
    add(
      90,
      "Avoid portable heaters for whole rooms",
      "For occupied rooms, an efficient reverse-cycle air conditioner usually uses less electricity than portable resistance heating. An electric throw can warm a person with much less energy.",
    );
  }

  if (
    reviewed(profile, "feature:heating-cooling-systems")
    && profile.features.includes("reverse-cycle")
    && profile.features.includes("gas-heating")
  ) {
    add(
      89,
      "Use reverse-cycle heating first",
      "When it can comfortably heat the occupied area, try the reverse-cycle air conditioner before gas heating and keep its filters clean.",
    );
  }

  if (
    reviewed(profile, "feature:ventilation-features")
    && profile.features.includes("evaporative-ducts")
  ) {
    add(
      88,
      "Check unused evaporative outlets",
      "If the evaporative system is safely shut down for the season, suitable removable outlet covers can reduce winter heat loss. Do not block an operating or required ventilation path.",
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
      87,
      "Improve windows without replacing them",
      weakCoverings || weakShade
        ? "Start with seals, close-fitting honeycomb or thermal coverings and external summer shade. Removable low-emissivity or reflective film may help where it suits the glass and sunlight."
        : "Check seals and room-by-room comfort first. Removable low-emissivity or reflective film may help where it suits the glass and sunlight.",
    );
  }

  if (
    reviewed(profile, "feature:external-shading")
    && profile.features.includes("external-shading-none")
    && reviewed(profile, "feature:comfort-concerns")
    && profile.features.includes("comfort-too-hot")
  ) {
    add(
      86,
      "Shade hot windows before upgrading cooling",
      "Use external shade where practical. A correctly placed deciduous tree can block summer sun while allowing winter sun after its leaves fall.",
    );
  }

  if (
    reviewed(profile, "feature:solar")
    && profile.features.includes("solar")
  ) {
    add(
      85,
      "Use more of your solar directly",
      "Run flexible loads such as the dishwasher, washing machine or heat-pump dryer during strong solar hours when it is safe and practical.",
    );
  }

  if (
    reviewed(profile, "supplemental:billPressure")
    && (profile.billPressure === "higher-than-expected" || profile.billPressure === "hard-to-manage")
  ) {
    add(
      78,
      "Shift flexible loads to cheaper hours",
      "Check the complete tariff, then move suitable loads to cheaper or free-use windows. A free three-hour period is only useful if the rest of the plan still suits the home.",
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
