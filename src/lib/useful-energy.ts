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
  costBasisLabel: string;
  climateBand: UsefulEnergyClimateBand | null;
  heatPumpCop: number;
  sourceHref: string;
  sourceLabel: string;
  options: readonly UsefulEnergyOption[];
};

const ROOM_HEATING_HOURS = 5;
const ROOM_HEAT_LOAD_KW = 2;
const ROOM_HEAT_OUTPUT_KWH = ROOM_HEATING_HOURS * ROOM_HEAT_LOAD_KW;
const HOT_WATER_USEFUL_HEAT_KWH = 14;

const PLANNING_HEAT_PUMP_COP = {
  "room-heating": { hot: 4.7, average: 4.2, cold: 3.7 },
  "hot-water": { hot: 4, average: 3.5, cold: 3 },
} as const satisfies Record<UsefulEnergyExampleId, Record<UsefulEnergyClimateBand, number>>;

export const USEFUL_ENERGY_EXAMPLES = [
  {
    id: "room-heating",
    label: "Room heating · 5 hours",
    description: "One room, one winter evening. This five-hour example supplies an average 2 kW of heat, giving the room 10 kWh of useful warmth. It uses a reverse-cycle COP of 3.7 and gas-heater efficiency of 85%.",
    costBasisLabel: "Illustrative five-hour cost at the 24-hour average",
    climateBand: null,
    heatPumpCop: 3.7,
    sourceHref: "https://www.energy.gov.au/households/energy-rating",
    sourceLabel: "Australian Government five-hour heating example",
    options: [
      { id: "direct-electric", label: "Direct electric heater", fuel: "electricity", inputKwh: ROOM_HEAT_OUTPUT_KWH, lowestEnergyUse: false },
      { id: "reverse-cycle", label: "Reverse-cycle heat pump", fuel: "electricity", inputKwh: ROOM_HEAT_OUTPUT_KWH / 3.7, lowestEnergyUse: true },
      { id: "gas-heater", label: "Gas heater", fuel: "gas", inputKwh: ROOM_HEAT_OUTPUT_KWH / .85, lowestEnergyUse: false },
    ],
  },
  {
    id: "hot-water",
    label: "Hot water · full tank",
    description: "One full 300 litre hot-water cycle. Each option heats the same tank to 60°C. The energy shown covers the whole heating task, not a fixed number of running hours. It uses a heat-pump COP of 3 and gas efficiency of 85%.",
    costBasisLabel: "Illustrative full-tank cost at the 24-hour average",
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
      description: `One room, one winter evening. This five-hour example supplies an average 2 kW of heat, or 10 kWh of useful warmth. Your postcode selected the ${climateLabel.toLowerCase()} Energy Rating climate band, so the planning COP is ${heatPumpCop.toFixed(1)}. Gas-heater efficiency remains 85%.`,
      options: base.options.map((option) => option.id === "reverse-cycle"
        ? { ...option, inputKwh: ROOM_HEAT_OUTPUT_KWH / heatPumpCop }
        : option),
    };
  }
  return {
    ...base,
    climateBand,
    heatPumpCop,
    description: `One full 300 litre hot-water cycle. Each option heats the same tank to 60°C. Your postcode selected a ${climateLabel.toLowerCase()} temperature context, so this planning example uses a heat-pump COP of ${heatPumpCop.toFixed(1)}. Gas efficiency remains 85%.`,
    sourceHref: "https://www.yourhome.gov.au/energy/hot-water-systems",
    sourceLabel: "Australian Government hot-water guidance",
    options: base.options.map((option) => option.id === "heat-pump-water-heater"
      ? { ...option, inputKwh: Number((HOT_WATER_USEFUL_HEAT_KWH / heatPumpCop).toFixed(1)) }
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
