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
  heatPumpPerformanceLabel: string;
  sourceHref: string;
  sourceLabel: string;
  options: readonly UsefulEnergyOption[];
};

const ROOM_HEATING_HOURS = 5;
const ROOM_HEAT_LOAD_KW = 2;
const ROOM_HEAT_OUTPUT_KWH = ROOM_HEATING_HOURS * ROOM_HEAT_LOAD_KW;
const HOT_WATER_USEFUL_HEAT_KWH = 14;

const PLANNING_HEAT_PUMP_COP = {
  "room-heating": { hot: 5, average: 4.5, cold: 4 },
  "hot-water": { hot: 4.5, average: 4, cold: 3.5 },
} as const satisfies Record<UsefulEnergyExampleId, Record<UsefulEnergyClimateBand, number>>;

export const USEFUL_ENERGY_EXAMPLES = [
  {
    id: "room-heating",
    label: "Room heating · 5 hours",
    description: "One room, one winter evening. This five-hour example supplies an average 2 kW of heat, giving the room 10 kWh of useful warmth. It models an efficient, correctly sized reverse-cycle unit with a seasonal heating factor of 4.5 and gas-heater efficiency of 85%.",
    costBasisLabel: "Illustrative five-hour cost at the 24-hour average",
    climateBand: null,
    heatPumpCop: PLANNING_HEAT_PUMP_COP["room-heating"].average,
    heatPumpPerformanceLabel: "seasonal heating factor",
    sourceHref: "https://www.energy.gov.au/households/heating-and-cooling",
    sourceLabel: "Australian Government reverse-cycle guidance",
    options: [
      { id: "direct-electric", label: "Direct electric heater", fuel: "electricity", inputKwh: ROOM_HEAT_OUTPUT_KWH, lowestEnergyUse: false },
      { id: "reverse-cycle", label: "Reverse-cycle heat pump", fuel: "electricity", inputKwh: ROOM_HEAT_OUTPUT_KWH / PLANNING_HEAT_PUMP_COP["room-heating"].average, lowestEnergyUse: true },
      { id: "gas-heater", label: "Gas heater", fuel: "gas", inputKwh: ROOM_HEAT_OUTPUT_KWH / .85, lowestEnergyUse: false },
    ],
  },
  {
    id: "hot-water",
    label: "Hot water · full tank",
    description: "One full 300 litre hot-water cycle. Each option heats the same tank from an assumed 20°C inlet temperature to 60°C. The energy shown covers the whole heating task, not a fixed number of running hours. It models an efficient, correctly sized heat pump with a heat-up-cycle COP of 4.0 and gas efficiency of 85%.",
    costBasisLabel: "Illustrative full-tank cost at the 24-hour average",
    climateBand: null,
    heatPumpCop: PLANNING_HEAT_PUMP_COP["hot-water"].average,
    heatPumpPerformanceLabel: "heat-up-cycle COP",
    sourceHref: "https://www.yourhome.gov.au/energy/hot-water-systems",
    sourceLabel: "Australian Government hot-water guidance",
    options: [
      { id: "electric-water-heater", label: "Standard electric system", fuel: "electricity", inputKwh: 14, lowestEnergyUse: false },
      { id: "heat-pump-water-heater", label: "Heat-pump hot water", fuel: "electricity", inputKwh: Number((HOT_WATER_USEFUL_HEAT_KWH / PLANNING_HEAT_PUMP_COP["hot-water"].average).toFixed(1)), lowestEnergyUse: true },
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
      description: `One room, one winter evening. This five-hour example supplies an average 2 kW of heat, or 10 kWh of useful warmth. Your postcode selected the ${climateLabel.toLowerCase()} Energy Rating climate band, so this efficient-system example uses a seasonal heating factor of ${heatPumpCop.toFixed(1)}. Gas-heater efficiency remains 85%.`,
      options: base.options.map((option) => option.id === "reverse-cycle"
        ? { ...option, inputKwh: ROOM_HEAT_OUTPUT_KWH / heatPumpCop }
        : option),
    };
  }
  return {
    ...base,
    climateBand,
    heatPumpCop,
    description: `One full 300 litre hot-water cycle. Each option heats the same tank from an assumed 20°C inlet temperature to 60°C. Your postcode selected a ${climateLabel.toLowerCase()} temperature context, so this efficient-system example uses a heat-up-cycle COP of ${heatPumpCop.toFixed(1)}. Gas efficiency remains 85%.`,
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

export function parseHouseholdEnergyRate(value: string): number | null {
  if (!value.trim()) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export function gasUsageRateCentsPerKwh(centsPerMj: number | null): number | null {
  if (centsPerMj === null) return null;
  if (!Number.isFinite(centsPerMj) || centsPerMj < 0) throw new RangeError("Gas usage rate must be a finite, non-negative number or null");
  return centsPerMj * 3.6;
}

export function annualSupplyChargeDollars(centsPerDay: number | null): number | null {
  if (centsPerDay === null) return null;
  if (!Number.isFinite(centsPerDay) || centsPerDay < 0) throw new RangeError("Daily supply rate must be a finite, non-negative number or null");
  return centsPerDay * 365 / 100;
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
