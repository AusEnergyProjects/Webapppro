export interface PublishedReferencePlan {
  key: string;
  id: string;
  name: string;
  brand: string;
  annualCost: number;
  rateDescription: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export type PublishedPlanMatch =
  | { status: "empty" | "invalid" | "missing"; plan: null; choices: PublishedReferencePlan[] }
  | { status: "ambiguous"; plan: null; choices: PublishedReferencePlan[] }
  | { status: "matched"; plan: PublishedReferencePlan; choices: PublishedReferencePlan[] };

/** AER namespaces identify the official catalogue; other opaque suffixes stay intact. */
function publicId(id: string): string {
  return id.replace(/@(VEC|EME)$/, "");
}

/** Match complete IDs, never a substring, plan name or a different record version. */
export function resolvePublishedPlanReference(
  value: string,
  plans: readonly PublishedReferencePlan[],
  selectedKey = "",
): PublishedPlanMatch {
  const id = value.trim();
  const compactId = id.replace(/\s/g, "");
  if (!id) return { status: "empty", plan: null, choices: [] };
  if (id.length > 128 || !/^[A-Z0-9][A-Z0-9._:-]*(?:@[A-Z0-9._:-]+)?$/i.test(compactId)) {
    return { status: "invalid", plan: null, choices: [] };
  }
  const now = Date.now();
  const choices = plans.filter((plan) => {
    // Only official human-readable IDs tolerate letter case and copy/paste spacing.
    const official = /^[A-Z0-9]+@(VEC|EME)$/i.test(plan.id);
    const publishedId = official ? plan.id.toUpperCase() : plan.id;
    const enteredId = official ? compactId.toUpperCase() : id;
    const from = plan.effectiveFrom ? Date.parse(plan.effectiveFrom) : null;
    const to = plan.effectiveTo ? Date.parse(plan.effectiveTo) : null;
    return Number.isFinite(plan.annualCost)
      && (from === null || Number.isFinite(from) && from <= now)
      && (to === null || Number.isFinite(to) && to > now)
      && (official && !enteredId.includes("@") ? publicId(publishedId) === enteredId : publishedId === enteredId);
  });
  if (!choices.length) return { status: "missing", plan: null, choices };
  if (choices.length === 1) return { status: "matched", plan: choices[0], choices };
  const selected = choices.find((plan) => plan.key === selectedKey);
  return selected
    ? { status: "matched", plan: selected, choices }
    : { status: "ambiguous", plan: null, choices };
}

export function annualPlanDifference(referenceCost: number, alternativeCost: number): number {
  return Math.round((referenceCost - alternativeCost) * 100) / 100;
}
