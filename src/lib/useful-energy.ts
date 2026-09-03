export type UsefulEnergyExampleId = "room-heating" | "hot-water";
export type UsefulEnergyFuel = "electricity" | "gas";

export type UsefulEnergyOption = {
  id: string;
  label: string;
  fuel: UsefulEnergyFuel;
  inputKwh: number;
  lowestEnergyUse: boolean;
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
    description: "To deliver the same 5 kWh of room heat, each option needs a different amount of input energy. This comparison uses a reverse-cycle COP of 3.7 and gas-heater efficiency of 85%.",
    sourceHref: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme/buyers-guides/heating-and-cooling-your-home-a-guide-to-reverse-cycle-systems",
    sourceLabel: "ACT Government room heating comparison",
    options: [
      { id: "direct-electric", label: "Direct electric heater", fuel: "electricity", inputKwh: ROOM_HEAT_KWH, lowestEnergyUse: false },
      { id: "reverse-cycle", label: "Reverse-cycle heat pump", fuel: "electricity", inputKwh: ROOM_HEAT_KWH / 3.7, lowestEnergyUse: true },
      { id: "gas-heater", label: "Gas heater", fuel: "gas", inputKwh: ROOM_HEAT_KWH / .85, lowestEnergyUse: false },
    ],
  },
  {
    id: "hot-water",
    label: "Hot water",
    description: "This worked example heats the same 300 litre tank to 60°C with each system. It uses a heat-pump COP of 3 and gas efficiency of 85%.",
    sourceHref: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme/buyers-guides/singing-in-the-shower-a-guide-to-hot-water-heat-pumps",
    sourceLabel: "ACT Government hot-water comparison",
    options: [
      { id: "electric-water-heater", label: "Standard electric system", fuel: "electricity", inputKwh: 14, lowestEnergyUse: false },
      { id: "heat-pump-water-heater", label: "Heat-pump hot water", fuel: "electricity", inputKwh: 4.7, lowestEnergyUse: true },
      { id: "gas-water-heater", label: "Gas hot-water system", fuel: "gas", inputKwh: 16.5, lowestEnergyUse: false },
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

export function purchasedEnergyReductionPercent(inputKwh: number, comparisonInputKwh: number): number {
  if (!Number.isFinite(inputKwh) || inputKwh < 0) throw new RangeError("Energy input must be a finite, non-negative number");
  if (!Number.isFinite(comparisonInputKwh) || comparisonInputKwh <= 0) throw new RangeError("Comparison energy input must be a finite number above zero");
  return Math.round((1 - inputKwh / comparisonInputKwh) * 100);
}

export function averageAvailablePriceCentsPerKwh(prices: readonly (number | null)[]): number | null {
  let total = 0;
  let count = 0;
  for (const price of prices) {
    if (price === null) continue;
    if (!Number.isFinite(price)) throw new RangeError("Energy prices must be finite or null");
    total += price;
    count++;
  }
  return count ? total / count : null;
}
