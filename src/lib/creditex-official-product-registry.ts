export const CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT =
  "creditex-official-products/v1" as const;
export const CREDITEX_OFFICIAL_PRODUCT_REGISTRY_REVIEWED_ON = "2026-08-08";

export const CREDITEX_OFFICIAL_PRODUCT_KINDS = [
  "pv_module",
  "inverter",
  "battery",
  "air_conditioner",
  "close_control_air_conditioner",
  "electric_water_heater",
  "gas_water_heater",
  "refrigerator_freezer",
  "television",
  "clothes_dryer",
  "pool_pump",
  "electric_motor",
  "commercial_refrigerator",
  "chiller",
  "wa_synergy_supported_solution",
  "wa_horizon_supported_solution",
] as const;

export type CreditexOfficialProductKind =
  typeof CREDITEX_OFFICIAL_PRODUCT_KINDS[number];

export const CREDITEX_PRODUCT_KIND_REGISTRY = {
  pv_module: "cer-cec-products",
  inverter: "cer-cec-products",
  battery: "cer-cec-products",
  air_conditioner: "gems-products",
  close_control_air_conditioner: "gems-products",
  electric_water_heater: "gems-products",
  gas_water_heater: "gems-products",
  refrigerator_freezer: "gems-products",
  television: "gems-products",
  clothes_dryer: "gems-products",
  pool_pump: "gems-products",
  electric_motor: "gems-products",
  commercial_refrigerator: "gems-products",
  chiller: "gems-products",
  wa_synergy_supported_solution: "wa-synergy-supported-solutions",
  wa_horizon_supported_solution: "wa-horizon-supported-solutions",
} as const satisfies Record<CreditexOfficialProductKind, string>;

export type CreditexOfficialProductRecord = {
  sourceKey: string;
  sourceRecordKey: string;
  productKind: CreditexOfficialProductKind;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registrationNumber: string;
  certificateNumber: string;
  approvalStatus: string;
  eligibleFrom: string;
  eligibleTo: string;
  availableInAustralia: boolean;
  attributes: Record<string, string | number | boolean | null>;
};

export type CreditexOfficialProductRegistryStatus = {
  registryCode: string;
  status: "current" | "stale" | "unavailable";
  freshnessWindowHours: number;
  snapshotId: string | null;
  sourceSha256: string | null;
  recordCount: number;
  lastCheckedAt: string | null;
  lastAttempt: {
    status: "success" | "unchanged" | "failed";
    checkedAt: string;
    message: string;
  } | null;
};

export type CreditexOfficialProductSelection = {
  id: string;
  registryCode: string;
  snapshotId: string;
  sourceKey: string;
  sourceRecordKey: string;
  productKind: CreditexOfficialProductKind;
  manufacturer: string;
  brand: string;
  model: string;
  series: string;
  registrationNumber: string;
  certificateNumber: string;
  approvalStatus: string;
  eligibleFrom: string;
  eligibleTo: string;
  attributes: Record<string, string | number | boolean | null>;
  sourceSha256: string;
};

export type CreditexFormulaProductSelection = Pick<
  CreditexOfficialProductSelection,
  "productKind" | "eligibleFrom" | "attributes"
>;

export type CreditexOfficialProductErrorCode =
  | "OFFICIAL_PRODUCT_REQUEST_INVALID"
  | "OFFICIAL_PRODUCT_KIND_UNSUPPORTED"
  | "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE"
  | "OFFICIAL_PRODUCT_REGISTRY_STALE"
  | "OFFICIAL_PRODUCT_SOURCE_UNAVAILABLE"
  | "OFFICIAL_PRODUCT_SOURCE_INVALID"
  | "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE"
  | "OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION"
  | "OFFICIAL_PRODUCT_SOURCE_CUSTODY_UNAVAILABLE"
  | "OFFICIAL_PRODUCT_SOURCE_CUSTODY_FAILED"
  | "OFFICIAL_PRODUCT_REGISTRY_INTEGRITY_FAILED"
  | "OFFICIAL_PRODUCT_REFRESH_IN_PROGRESS"
  | "OFFICIAL_PRODUCT_SELECTION_REQUIRED"
  | "OFFICIAL_PRODUCT_NOT_ELIGIBLE";

export class CreditexOfficialProductError extends Error {
  readonly code: CreditexOfficialProductErrorCode;
  readonly status: number;

  constructor(
    code: CreditexOfficialProductErrorCode,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreditexOfficialProductError";
    this.code = code;
    this.status = status;
  }
}

export function officialProductKindsForLocalActivity(
  programCode: string,
  activityCode: string,
): readonly CreditexOfficialProductKind[] {
  if (programCode === "QLD-SSR") return ["pv_module", "inverter"];
  if (programCode === "QLD-QCHEU" && activityCode === "PV") {
    return ["pv_module", "inverter"];
  }
  if (programCode === "QLD-QCHEU" && activityCode === "HVAC") {
    return ["air_conditioner"];
  }
  if (programCode === "WA-RBS" && activityCode === "SYNERGY-BATTERY") {
    return ["battery", "inverter", "wa_synergy_supported_solution"];
  }
  if (programCode === "WA-RBS" && activityCode === "HORIZON-BATTERY") {
    return ["battery", "inverter", "wa_horizon_supported_solution"];
  }
  if (programCode === "WA-BATTERY-REWARDS") {
    return ["battery", "inverter", "wa_synergy_supported_solution"];
  }
  if (programCode === "WA-HORIZON-BUYBACK") {
    return ["battery", "inverter", "wa_horizon_supported_solution"];
  }
  if (programCode === "NT-SMD" && activityCode === "SHARED-PV") {
    return ["pv_module", "inverter"];
  }
  if (programCode === "NT-SMD" && activityCode === "BATTERY") {
    return ["battery", "inverter"];
  }
  return [];
}

export function officialProductKindsForNswProductKinds(
  productKinds: readonly string[],
): readonly CreditexOfficialProductKind[] {
  const kinds = new Set<CreditexOfficialProductKind>();
  for (const kind of productKinds) {
    if (kind === "air_conditioner") {
      kinds.add("air_conditioner");
    } else if (kind === "refrigerated_cabinet") {
      kinds.add("commercial_refrigerator");
    } else if (kind === "pool_pump") {
      kinds.add("pool_pump");
    }
  }
  return [...kinds];
}

export function unresolvedNswProductKinds(
  productKinds: readonly string[],
): readonly string[] {
  return productKinds.filter((kind) => (
    kind !== "air_conditioner"
    && kind !== "refrigerated_cabinet"
    && kind !== "pool_pump"
  ));
}

export function creditexSresCalculationBlocker(technology: string) {
  if (technology === "solar_pv") {
    return "The current federal approved-module feed does not publish rated module power, so installed system capacity cannot be derived or exactly cross-checked against the selected modules.";
  }
  if (technology === "solar_battery") {
    return "The current federal product feeds publish battery capacity but do not establish the installed inverter's required VPP capability and final eligible system configuration.";
  }
  if (technology === "small_wind" || technology === "small_hydro") {
    return `The current federal sources do not provide a controlled ${technology === "small_wind" ? "small-wind" : "small-hydro"} equipment registry or an installed approved-inverter selection, so rated capacity and applicable component eligibility cannot be cross-checked.`;
  }
  return null;
}

const NSW_OFFICIAL_PRODUCT_INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "HVAC1-SINGLE": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "rated_cooling_capacity_kw",
    "rated_cooling_input_kw",
    "product_registry_eligibility_confirmed",
  ],
  "HVAC1-MULTI": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "outdoor_cooling_capacity_kw",
    "outdoor_rated_cooling_input_kw",
    "product_registry_eligibility_confirmed",
  ],
  "HVAC2-SINGLE": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "rated_cooling_capacity_kw",
    "rated_cooling_input_kw",
    "product_registry_eligibility_confirmed",
  ],
  "HVAC2-MULTI": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "outdoor_cooling_capacity_kw",
    "outdoor_rated_cooling_input_kw",
    "product_registry_eligibility_confirmed",
  ],
  "RF2-REMOTE": [
    "product_class",
    "tec_kwh_per_24h",
    "product_eei",
    "product_registry_eligibility_confirmed",
  ],
  SYS2: [
    "maximum_tested_input_w",
    "paec_kwh_per_year",
    "daily_run_time_hours",
    "product_registry_eligibility_confirmed",
  ],
  D5: [
    "maximum_tested_input_w",
    "paec_kwh_per_year",
    "product_registry_eligibility_confirmed",
  ],
  "D16-SINGLE": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "heating_efficiency_basis",
    "heating_efficiency_value",
    "cooling_capacity_kw",
    "heating_capacity_kw",
    "cooling_annual_energy_kwh",
    "heating_annual_energy_kwh",
    "product_registry_eligibility_confirmed",
  ],
  "D16-MULTI": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "heating_efficiency_basis",
    "heating_efficiency_value",
    "outdoor_cooling_capacity_kw",
    "outdoor_heating_capacity_kw",
    "cooling_annual_energy_kwh",
    "heating_annual_energy_kwh",
    "product_registry_eligibility_confirmed",
  ],
  "F4-SINGLE": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "heating_efficiency_basis",
    "heating_efficiency_value",
    "cooling_capacity_kw",
    "heating_capacity_kw",
    "cooling_annual_energy_kwh",
    "heating_annual_energy_kwh",
    "product_registry_eligibility_confirmed",
  ],
  "F4-MULTI": [
    "product_class",
    "cooling_efficiency_basis",
    "cooling_efficiency_value",
    "heating_efficiency_basis",
    "heating_efficiency_value",
    "outdoor_cooling_capacity_kw",
    "outdoor_heating_capacity_kw",
    "cooling_annual_energy_kwh",
    "heating_annual_energy_kwh",
    "product_registry_eligibility_confirmed",
  ],
};

export function officialProductInputKeysForNswActivity(activityCode: string) {
  return NSW_OFFICIAL_PRODUCT_INPUT_KEYS[activityCode] || [];
}

function officialProductFailure(message: string): never {
  throw new CreditexOfficialProductError(
    "OFFICIAL_PRODUCT_NOT_ELIGIBLE",
    409,
    message,
  );
}

function selectedProduct(
  selections: readonly CreditexFormulaProductSelection[],
  productKind: CreditexOfficialProductKind,
) {
  const selection = selections.find((item) => item.productKind === productKind);
  if (!selection) {
    return officialProductFailure(
      `Select a current official ${officialProductKindLabel(productKind)}.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.eligibleFrom)) {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(productKind)} has no defensible approval start date in the active snapshot. Refresh the official registry before using it.`,
    );
  }
  return selection;
}

function officialNumber(
  selection: CreditexFormulaProductSelection,
  key: string,
  label: string,
  options: { allowZero?: boolean } = {},
) {
  const value = selection.attributes[key];
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || (options.allowZero ? value < 0 : value <= 0)
  ) {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(selection.productKind)} does not publish a valid ${label}. Choose another current product or refresh the official source.`,
    );
  }
  return value;
}

function optionalPositiveNumber(
  selection: CreditexFormulaProductSelection,
  key: string,
) {
  const value = selection.attributes[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function officialText(
  selection: CreditexFormulaProductSelection,
  key: string,
  label: string,
) {
  const value = selection.attributes[key];
  if (typeof value !== "string" || !value.trim()) {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(selection.productKind)} does not publish ${label}. Choose another current product or refresh the official source.`,
    );
  }
  return value.trim();
}

function officialClass(selection: CreditexFormulaProductSelection) {
  const value = officialText(selection, "sourceProductClass", "a GEMS product class");
  const match = /^Class\s+(\d+)$/.exec(value);
  if (!match) {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(selection.productKind)} has an unsupported GEMS product class ${JSON.stringify(value)}.`,
    );
  }
  return match[1];
}

function setOfficialNumber(
  inputs: Record<string, unknown>,
  key: string,
  value: number,
) {
  inputs[key] = String(value);
}

const ESS_COLD_CLIMATE_POSTCODE_RANGES: readonly [number, number][] = [
  [2328, 2329], [2333, 2333], [2336, 2347], [2350, 2361], [2365, 2365],
  [2369, 2372], [2379, 2382], [2395, 2396], [2403, 2404], [2453, 2453],
  [2475, 2476], [2527, 2527], [2529, 2529], [2533, 2541], [2545, 2546],
  [2548, 2551], [2575, 2588], [2590, 2590], [2594, 2594], [2600, 2607],
  [2609, 2609], [2611, 2612], [2614, 2615], [2617, 2633], [2640, 2647],
  [2649, 2653], [2655, 2656], [2658, 2661], [2663, 2663], [2665, 2666],
  [2668, 2668], [2671, 2671], [2701, 2702], [2712, 2712], [2720, 2722],
  [2725, 2727], [2729, 2730], [2776, 2776], [2778, 2780], [2782, 2787],
  [2790, 2795], [2797, 2800], [2803, 2810], [2820, 2821], [2823, 2825],
  [2827, 2830], [2842, 2850], [2852, 2852], [2864, 2871], [2873, 2876],
  [3644, 3644], [3707, 3707],
];

const ESS_HOT_CLIMATE_POSTCODE_RANGES: readonly [number, number][] = [
  [2477, 2479], [2481, 2490],
];

function inPostcodeRanges(
  postcode: number,
  ranges: readonly [number, number][],
) {
  return ranges.some(([start, end]) => postcode >= start && postcode <= end);
}

function essAirConditionerClimate(inputs: Record<string, unknown>) {
  const text = String(inputs.site_postcode || "").trim();
  if (!/^\d{4}$/.test(text)) {
    return officialProductFailure(
      "Enter the physical installation postcode before resolving official air-conditioner metrics.",
    );
  }
  const postcode = Number(text);
  if (postcode === 2730) {
    return officialProductFailure(
      "ESS Table A27 places postcode 2730 in conflicting cold and average rows, so the official product metrics cannot be selected deterministically.",
    );
  }
  if (inPostcodeRanges(postcode, ESS_HOT_CLIMATE_POSTCODE_RANGES)) return "Hot";
  if (inPostcodeRanges(postcode, ESS_COLD_CLIMATE_POSTCODE_RANGES)) return "Cold";
  return "Mixed";
}

function deriveNswAirConditionerInputs(
  programCode: string,
  activityCode: string,
  inputs: Record<string, unknown>,
  selections: readonly CreditexFormulaProductSelection[],
) {
  const selection = selectedProduct(selections, "air_conditioner");
  const commercial = activityCode.startsWith("HVAC2")
    || activityCode.startsWith("F4");
  const multi = activityCode.endsWith("-MULTI");
  inputs.product_class = officialClass(selection);
  inputs.product_registry_eligibility_confirmed = "yes";

  const coolingSeasonalKey = commercial
    ? "commercialTcspfMixed"
    : "residentialTcspfMixed";
  const coolingSeasonal = optionalPositiveNumber(selection, coolingSeasonalKey);
  const coolingFallback = optionalPositiveNumber(selection, "aeeR");
  if (coolingSeasonal !== null) {
    inputs.cooling_efficiency_basis = "tcspf";
    setOfficialNumber(inputs, "cooling_efficiency_value", coolingSeasonal);
  } else if (coolingFallback !== null) {
    inputs.cooling_efficiency_basis = "rated_aeer_no_tcspf";
    setOfficialNumber(inputs, "cooling_efficiency_value", coolingFallback);
  } else {
    officialProductFailure(
      "The selected air conditioner publishes neither the applicable TCSPF_mixed nor the permitted rated AEER fallback.",
    );
  }

  const coolingCapacity = officialNumber(
    selection,
    "ratedCoolingCapacityKw",
    "rated cooling capacity",
  );
  if (programCode === "NSW-PDRS-2026") {
    const coolingInput = officialNumber(
      selection,
      "ratedCoolingInputKw",
      "rated cooling input power",
    );
    if (multi) {
      setOfficialNumber(inputs, "outdoor_cooling_capacity_kw", coolingCapacity);
      setOfficialNumber(inputs, "outdoor_rated_cooling_input_kw", coolingInput);
    } else {
      setOfficialNumber(inputs, "rated_cooling_capacity_kw", coolingCapacity);
      setOfficialNumber(inputs, "rated_cooling_input_kw", coolingInput);
    }
    return inputs;
  }

  const heatingCapacity = officialNumber(
    selection,
    "ratedHeatingCapacityKw",
    "rated heating capacity",
  );
  const climate = essAirConditionerClimate(inputs);
  const heatingSeasonalKey = `${commercial ? "commercial" : "residential"}Hspf${climate === "Cold" ? "Cold" : "Mixed"}`;
  const heatingSeasonal = optionalPositiveNumber(selection, heatingSeasonalKey);
  const heatingFallback = optionalPositiveNumber(selection, "acop");
  if (heatingSeasonal !== null) {
    inputs.heating_efficiency_basis = "hspf";
    setOfficialNumber(inputs, "heating_efficiency_value", heatingSeasonal);
  } else if (heatingFallback !== null) {
    inputs.heating_efficiency_basis = "rated_acop_no_hspf";
    setOfficialNumber(inputs, "heating_efficiency_value", heatingFallback);
  } else {
    officialProductFailure(
      "The selected air conditioner publishes neither the applicable HSPF nor the permitted rated ACOP fallback.",
    );
  }

  if (multi) {
    setOfficialNumber(inputs, "outdoor_cooling_capacity_kw", coolingCapacity);
    setOfficialNumber(inputs, "outdoor_heating_capacity_kw", heatingCapacity);
  } else {
    setOfficialNumber(inputs, "cooling_capacity_kw", coolingCapacity);
    setOfficialNumber(inputs, "heating_capacity_kw", heatingCapacity);
  }
  const prefix = commercial ? "commercial" : "residential";
  setOfficialNumber(
    inputs,
    "cooling_annual_energy_kwh",
    officialNumber(
      selection,
      `${prefix}CoolingEnergy${climate}Kwh`,
      `applicable ${commercial ? "Commercial" : "Residential"} tcec`,
      { allowZero: true },
    ),
  );
  setOfficialNumber(
    inputs,
    "heating_annual_energy_kwh",
    officialNumber(
      selection,
      `${prefix}HeatingEnergy${climate}Kwh`,
      `applicable ${commercial ? "Commercial" : "Residential"} thec`,
      { allowZero: true },
    ),
  );
  return inputs;
}

export function deriveCreditexNswOfficialProductInputs(
  programCode: string,
  activityCode: string,
  callerInputs: Record<string, unknown>,
  selections: readonly CreditexFormulaProductSelection[],
) {
  const inputs = { ...callerInputs };
  if (activityCode.startsWith("HVAC") || activityCode.startsWith("D16") || activityCode.startsWith("F4")) {
    return deriveNswAirConditionerInputs(
      programCode,
      activityCode,
      inputs,
      selections,
    );
  }
  if (activityCode === "RF2-REMOTE") {
    const selection = selectedProduct(selections, "commercial_refrigerator");
    setOfficialNumber(
      inputs,
      "product_class",
      officialNumber(selection, "productClassNumber", "product class"),
    );
    setOfficialNumber(
      inputs,
      "tec_kwh_per_24h",
      officialNumber(selection, "totalEnergyConsumptionKwhPer24h", "TEC"),
    );
    setOfficialNumber(
      inputs,
      "product_eei",
      officialNumber(selection, "energyEfficiencyIndex", "energy efficiency index"),
    );
    inputs.product_registry_eligibility_confirmed = "yes";
    return inputs;
  }
  if (activityCode === "SYS2" || activityCode === "D5") {
    const selection = selectedProduct(selections, "pool_pump");
    const starRating = officialNumber(selection, "starRating", "star rating");
    if (starRating < 4) {
      officialProductFailure(
        `The selected pool pump has ${starRating} stars; ${activityCode} requires at least 4 stars.`,
      );
    }
    setOfficialNumber(
      inputs,
      "maximum_tested_input_w",
      officialNumber(selection, "maximumTestedInputW", "maximum tested input"),
    );
    setOfficialNumber(
      inputs,
      "paec_kwh_per_year",
      officialNumber(
        selection,
        "projectedAnnualEnergyConsumptionKwh",
        "projected annual energy consumption",
        { allowZero: true },
      ),
    );
    if (activityCode === "SYS2") {
      setOfficialNumber(
        inputs,
        "daily_run_time_hours",
        officialNumber(selection, "dailyRunTimeHours", "daily run time"),
      );
    }
    inputs.product_registry_eligibility_confirmed = "yes";
    return inputs;
  }
  return inputs;
}

function derivedVeu22Scenario(selection: CreditexFormulaProductSelection) {
  const group = officialText(
    selection,
    "refrigeratorGroup",
    "an AS/NZS 4474:2018 product group",
  ).toUpperCase();
  const scenario = group === "1"
    ? "22A"
    : ["4", "5B", "5S", "5T"].includes(group)
      ? "22B"
      : group === "6C"
        ? "22C"
        : ["6U", "7"].includes(group)
          ? "22D"
          : null;
  if (!scenario) {
    return officialProductFailure(
      `GEMS group ${JSON.stringify(group)} is not eligible for VEU activity 22.`,
    );
  }
  const designation = officialText(
    selection,
    "refrigeratorDesignation",
    "the appliance designation",
  );
  if (designation.toLowerCase() === "cooled appliance") {
    officialProductFailure(
      "VEU activity 22 excludes products designated as a cooled appliance.",
    );
  }
  const compartments = officialText(
    selection,
    "compartmentTypes",
    "the compartment designations",
  );
  if (/(?:wine\s*storage|cellar|pantry)/i.test(compartments)) {
    officialProductFailure(
      "The selected refrigerator has a wine-storage, cellar or pantry compartment and is not eligible for VEU activity 22.",
    );
  }
  const totalVolume = officialNumber(
    selection,
    "totalVolumeLitres",
    "total storage volume",
  );
  if (totalVolume < 250 || totalVolume > 700) {
    officialProductFailure(
      `The selected refrigerator/freezer has ${totalVolume} L total storage volume; VEU activity 22 requires 250 to 700 L inclusive.`,
    );
  }
  const starRating = officialNumber(selection, "starRating", "star rating");
  const minimumStars = scenario === "22A" || scenario === "22B" ? 5.5 : 4;
  if (starRating < minimumStars) {
    officialProductFailure(
      `The selected refrigerator/freezer has ${starRating} stars; scenario ${scenario} requires at least ${minimumStars}.`,
    );
  }
  return scenario;
}

export function deriveCreditexVeuOfficialProductInputs(
  activityCode: string,
  callerInputs: Record<string, unknown>,
  selections: readonly CreditexFormulaProductSelection[],
) {
  const inputs = { ...callerInputs };
  if (activityCode === "22") {
    const selection = selectedProduct(selections, "refrigerator_freezer");
    inputs.scenario = derivedVeu22Scenario(selection);
    return inputs;
  }
  if (activityCode === "24") {
    const selection = selectedProduct(selections, "television");
    const starRating = officialNumber(selection, "starRating", "star rating");
    const screenArea = officialNumber(selection, "screenAreaCm2", "screen area");
    if (starRating < 6 || screenArea < 4_000) {
      officialProductFailure(
        `VEU activity 24 requires at least 6 stars and 4,000 cm2 screen area; the selected television records ${starRating} stars and ${screenArea} cm2.`,
      );
    }
    inputs.scenario = "24A";
    return inputs;
  }
  if (activityCode === "25") {
    const selection = selectedProduct(selections, "clothes_dryer");
    const starRating = officialNumber(selection, "starRating", "star rating");
    const capacity = officialNumber(selection, "capacityKg", "drying capacity");
    if (selection.attributes.isStandaloneClothesDryer !== true) {
      officialProductFailure(
        "VEU activity 25 requires a standalone clothes dryer and excludes combination washer/dryers.",
      );
    }
    if (starRating < 7 || capacity < 5) {
      officialProductFailure(
        `VEU activity 25 requires at least 7 stars and 5 kg capacity; the selected dryer records ${starRating} stars and ${capacity} kg.`,
      );
    }
    inputs.scenario = "25A";
    return inputs;
  }
  return inputs;
}

export function officialProductKindsForVeuActivity(
  activityCode: string,
): readonly CreditexOfficialProductKind[] {
  if (activityCode === "22") return ["refrigerator_freezer"];
  if (activityCode === "24") return ["television"];
  if (activityCode === "25") return ["clothes_dryer"];
  return [];
}

export function officialProductKindLabel(kind: CreditexOfficialProductKind) {
  const labels: Record<CreditexOfficialProductKind, string> = {
    pv_module: "PV module",
    inverter: "inverter",
    battery: "battery",
    air_conditioner: "air conditioner",
    close_control_air_conditioner: "close-control air conditioner",
    electric_water_heater: "electric water heater",
    gas_water_heater: "gas water heater",
    refrigerator_freezer: "refrigerator or freezer",
    television: "television",
    clothes_dryer: "clothes dryer",
    pool_pump: "pool pump",
    electric_motor: "electric motor",
    commercial_refrigerator: "commercial refrigerator",
    chiller: "chiller",
    wa_synergy_supported_solution: "Synergy supported solution",
    wa_horizon_supported_solution: "Horizon Power supported solution",
  };
  return labels[kind];
}
