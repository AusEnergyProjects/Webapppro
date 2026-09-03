export type UsefulEnergyExampleId = "room-heating" | "hot-water";
export type UsefulEnergyFuel = "electricity" | "gas";

export type UsefulEnergyOption = {
  id: string;
  label: string;
  fuel: UsefulEnergyFuel;
  inputKwh: number;
  inputLabel: string;
};

export type UsefulEnergyExample = {
  id: UsefulEnergyExampleId;
  label: string;
  description: string;
  sourceHref: string;
  sourceLabel: string;
  options: readonly UsefulEnergyOption[];
};

const ROOM_HEAT_KWH = 5;

export const USEFUL_ENERGY_EXAMPLES = [
  {
    id: "room-heating",
    label: "Room heating",
    description: "Imagine a room needs 5 kWh of heat over one cold hour. These options provide the same amount of warmth using the official example performance figures.",
    sourceHref: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme/buyers-guides/heating-and-cooling-your-home-a-guide-to-reverse-cycle-systems",
    sourceLabel: "ACT Government room heating comparison",
    options: [
      { id: "direct-electric", label: "Direct electric heater", fuel: "electricity", inputKwh: ROOM_HEAT_KWH, inputLabel: "5.0 kWh electricity" },
      { id: "reverse-cycle", label: "Reverse-cycle heater", fuel: "electricity", inputKwh: ROOM_HEAT_KWH / 3.7, inputLabel: "1.4 kWh electricity at example COP 3.7" },
      { id: "gas-heater", label: "Gas heater", fuel: "gas", inputKwh: ROOM_HEAT_KWH / .85, inputLabel: "5.9 kWh gas at example 85% efficiency" },
    ],
  },
  {
    id: "hot-water",
    label: "Hot water",
    description: "This official worked example heats a standard 300 litre hot-water tank to 60°C. Each option heats the same tank to the same temperature.",
    sourceHref: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme/buyers-guides/singing-in-the-shower-a-guide-to-hot-water-heat-pumps",
    sourceLabel: "ACT Government hot-water comparison",
    options: [
      { id: "electric-water-heater", label: "Standard electric system", fuel: "electricity", inputKwh: 14, inputLabel: "14.0 kWh electricity" },
      { id: "heat-pump-water-heater", label: "Heat-pump hot water", fuel: "electricity", inputKwh: 4.7, inputLabel: "4.7 kWh electricity at example COP 3" },
      { id: "gas-water-heater", label: "Gas hot-water system", fuel: "gas", inputKwh: 16.5, inputLabel: "16.5 kWh gas equivalent at example 85% efficiency" },
    ],
  },
] as const satisfies readonly UsefulEnergyExample[];

export function usefulEnergyExample(id: UsefulEnergyExampleId): UsefulEnergyExample {
  return USEFUL_ENERGY_EXAMPLES.find((example) => example.id === id)!;
}

export function wholesaleInputCostCents(inputKwh: number, priceCentsPerKwh: number | null): number | null {
  if (!Number.isFinite(inputKwh) || inputKwh < 0) throw new RangeError("Energy input must be a finite, non-negative number");
  if (priceCentsPerKwh === null) return null;
  if (!Number.isFinite(priceCentsPerKwh)) throw new RangeError("Energy price must be finite or null");
  return inputKwh * priceCentsPerKwh;
}
