import type { NemRegionId } from "./nem-wholesale";

const REGION_BY_STATE: Partial<Record<string, NemRegionId>> = {
  ACT: "NSW1",
  NSW: "NSW1",
  QLD: "QLD1",
  SA: "SA1",
  TAS: "TAS1",
  VIC: "VIC1",
};

const STATE_LABELS: Record<string, string> = {
  ACT: "the ACT",
  NSW: "New South Wales",
  NT: "the Northern Territory",
  QLD: "Queensland",
  SA: "South Australia",
  TAS: "Tasmania",
  VIC: "Victoria",
  WA: "Western Australia",
};

export type WholesalePostcodeLocation = {
  kind: "ambiguous" | "outside-nem" | "region";
  regionId: NemRegionId | null;
  stateLabels: string[];
  states: string[];
};

export function wholesaleLocationForStates(stateValues: readonly string[]): WholesalePostcodeLocation | null {
  const normalisedStates = stateValues.map((value) => String(value || "").trim().toUpperCase());
  if (!normalisedStates.length || normalisedStates.some((state) => !STATE_LABELS[state])) return null;
  const states = [...new Set(normalisedStates)];
  const regionIds = states.map((state) => REGION_BY_STATE[state] ?? null);
  const nemRegions = [...new Set(regionIds.filter((regionId): regionId is NemRegionId => regionId !== null))];
  const hasOutsideNemState = regionIds.some((regionId) => regionId === null);
  const kind = hasOutsideNemState
    ? nemRegions.length ? "ambiguous" : "outside-nem"
    : nemRegions.length === 1 ? "region" : "ambiguous";
  return {
    kind,
    regionId: kind === "region" ? nemRegions[0] : null,
    stateLabels: states.map((state) => STATE_LABELS[state]),
    states,
  };
}
