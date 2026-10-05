const HEAT_COLOURS = [
  "rgb(37, 99, 235)",
  "rgb(6, 182, 212)",
  "rgb(250, 204, 21)",
  "rgb(249, 115, 22)",
  "rgb(220, 38, 38)",
];

/** Palette preview for the heat toggle. Numeric legends must use the actual scale bands. */
export const COUNCIL_MAP_HEAT_GRADIENT = `linear-gradient(to right, ${HEAT_COLOURS.map((color, index) => `${color} ${index * 20}%, ${color} ${(index + 1) * 20}%`).join(", ")})`;

export type CouncilMapHeat = { color: string; ratio: number };
export type CouncilMapHeatBand = CouncilMapHeat & {
  /** Classification interval is lower < value <= upper. Zero is separate. */
  lower: number;
  upper: number;
  /** First observed value in this band, for an exact observed-range legend. */
  minimum: number;
  count: number;
};
export type CouncilMapHeatScale = {
  bands: CouncilMapHeatBand[];
  positiveCount: number;
  zeroCount: number;
  unavailableCount: number;
};

/** Build once from all reporting postcodes, never the visible map subset.
 * Nearest-rank quintiles keep source values as exact boundaries. Tied boundaries
 * collapse rather than assigning different colours to the same quantity.
 */
export function createCouncilMapHeatScale(values: readonly (number | null)[]): CouncilMapHeatScale {
  const positive = values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const zeroCount = values.filter(value => value === 0).length;
  const scale: CouncilMapHeatScale = { bands: [], positiveCount: positive.length, zeroCount, unavailableCount: values.length - positive.length - zeroCount };
  if (!positive.length) return scale;
  const thresholds = [...new Set(Array.from({ length: 5 }, (_, index) => positive[Math.ceil((index + 1) * positive.length / 5) - 1]))];
  let start = 0;
  scale.bands = thresholds.map((upper, index) => {
    const minimum = positive[start];
    let end = start;
    while (end < positive.length && positive[end] <= upper) end++;
    const count = end - start;
    start = end;
    const colourIndex = thresholds.length === 1 ? 2 : Math.round(index * (HEAT_COLOURS.length - 1) / (thresholds.length - 1));
    return { lower: index === 0 ? 0 : thresholds[index - 1], upper, minimum, count, color: HEAT_COLOURS[colourIndex], ratio: colourIndex / (HEAT_COLOURS.length - 1) };
  });
  return scale;
}

/** Nulls and invalid values stay distinct from a reported zero. */
export function councilMapHeat(value: number | null, scale: CouncilMapHeatScale): CouncilMapHeat | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (value === 0) return { color: HEAT_COLOURS[0], ratio: 0 };
  const band = scale.bands.find(item => value > item.lower && value <= item.upper);
  return band ? { color: band.color, ratio: band.ratio } : null;
}
