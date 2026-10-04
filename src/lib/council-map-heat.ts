type HeatColourStop = { ratio: number; rgb: readonly [number, number, number] };

const HEAT_COLOUR_STOPS: readonly HeatColourStop[] = [
  { ratio: 0, rgb: [37, 99, 235] },
  { ratio: 0.25, rgb: [6, 182, 212] },
  { ratio: 0.5, rgb: [250, 204, 21] },
  { ratio: 0.75, rgb: [249, 115, 22] },
  { ratio: 1, rgb: [220, 38, 38] },
];

function rgbColour(rgb: readonly number[]): string {
  return `rgb(${rgb.join(", ")})`;
}

/** The legend and map marks use the same linear colour scale. */
export const COUNCIL_MAP_HEAT_GRADIENT = `linear-gradient(to right, ${HEAT_COLOUR_STOPS.map(stop => `${rgbColour(stop.rgb)} ${stop.ratio * 100}%`).join(", ")})`;

export type CouncilMapHeat = { color: string; ratio: number };

/** Missing values stay distinct from a reported zero at the cool end of the scale. */
export function councilMapHeat(value: number | null, maximum: number): CouncilMapHeat | null {
  if (value === null || !Number.isFinite(value) || value < 0 || !Number.isFinite(maximum) || maximum < 0) return null;
  const ratio = maximum > 0 ? Math.min(value / maximum, 1) : value === 0 ? 0 : 1;
  for (let index = 1; index < HEAT_COLOUR_STOPS.length; index++) {
    const upper = HEAT_COLOUR_STOPS[index];
    if (ratio > upper.ratio) continue;
    const lower = HEAT_COLOUR_STOPS[index - 1];
    const fraction = (ratio - lower.ratio) / (upper.ratio - lower.ratio);
    const rgb = lower.rgb.map((channel, channelIndex) => Math.round(channel + (upper.rgb[channelIndex] - channel) * fraction));
    return { color: rgbColour(rgb), ratio };
  }
  return { color: rgbColour(HEAT_COLOUR_STOPS[HEAT_COLOUR_STOPS.length - 1].rgb), ratio };
}
