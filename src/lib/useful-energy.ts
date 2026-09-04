export type UsefulEnergyExampleId = "room-heating" | "hot-water";
export type UsefulEnergyFuel = "electricity" | "gas";
export type UsefulEnergyClimateBand = "hot" | "average" | "cold";

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
  climateBand: UsefulEnergyClimateBand | null;
  heatPumpCop: number;
  sourceHref: string;
  sourceLabel: string;
  options: readonly UsefulEnergyOption[];
};

const ROOM_HEAT_KWH = 5;
const HOT_WATER_OUTPUT_KWH = 14;

const PLANNING_HEAT_PUMP_COP = {
  "room-heating": { hot: 4.7, average: 4.2, cold: 3.7 },
  "hot-water": { hot: 4, average: 3.5, cold: 3 },
} as const satisfies Record<UsefulEnergyExampleId, Record<UsefulEnergyClimateBand, number>>;

export const USEFUL_ENERGY_EXAMPLES = [
  {
    id: "room-heating",
    label: "Room heating",
    description: "To deliver the same 5 kWh of room heat, each option needs a different amount of input energy. This comparison uses a reverse-cycle COP of 3.7 and gas-heater efficiency of 85%.",
    climateBand: null,
    heatPumpCop: 3.7,
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
    climateBand: null,
    heatPumpCop: 3,
    sourceHref: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme/buyers-guides/singing-in-the-shower-a-guide-to-hot-water-heat-pumps",
    sourceLabel: "ACT Government hot-water comparison",
    options: [
      { id: "electric-water-heater", label: "Standard electric system", fuel: "electricity", inputKwh: 14, lowestEnergyUse: false },
      { id: "heat-pump-water-heater", label: "Heat-pump hot water", fuel: "electricity", inputKwh: 4.7, lowestEnergyUse: true },
      { id: "gas-water-heater", label: "Gas hot-water system", fuel: "gas", inputKwh: 16.5, lowestEnergyUse: false },
    ],
  },
] as const satisfies readonly UsefulEnergyExample[];

export function usefulEnergyExample(id: UsefulEnergyExampleId, climateBand: UsefulEnergyClimateBand | null = null): UsefulEnergyExample {
  const base = USEFUL_ENERGY_EXAMPLES.find((example) => example.id === id)!;
  if (!climateBand) return base;
  const heatPumpCop = PLANNING_HEAT_PUMP_COP[id][climateBand];
  const climateLabel = `${climateBand[0].toUpperCase()}${climateBand.slice(1)}`;
  if (id === "room-heating") {
    return {
      ...base,
      climateBand,
      heatPumpCop,
      description: `Your postcode selected the ${climateLabel.toLowerCase()} Energy Rating climate band. This planning example uses a reverse-cycle COP of ${heatPumpCop.toFixed(1)} and gas-heater efficiency of 85% to deliver the same 5 kWh of room heat.`,
      sourceHref: "https://www.energy.gov.au/households/heating-and-cooling",
      sourceLabel: "Australian Government heating and cooling guidance",
      options: base.options.map((option) => option.id === "reverse-cycle"
        ? { ...option, inputKwh: ROOM_HEAT_KWH / heatPumpCop }
        : option),
    };
  }
  return {
    ...base,
    climateBand,
    heatPumpCop,
    description: `Your postcode selected a ${climateLabel.toLowerCase()} temperature context. This planning example uses a heat-pump COP of ${heatPumpCop.toFixed(1)} and gas efficiency of 85% to heat the same 300 litre tank to 60°C.`,
    sourceHref: "https://www.yourhome.gov.au/energy/hot-water-systems",
    sourceLabel: "Australian Government hot-water guidance",
    options: base.options.map((option) => option.id === "heat-pump-water-heater"
      ? { ...option, inputKwh: Number((HOT_WATER_OUTPUT_KWH / heatPumpCop).toFixed(1)) }
      : option),
  };
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
