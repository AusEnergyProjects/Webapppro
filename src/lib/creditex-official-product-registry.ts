export const CREDITEX_OFFICIAL_PRODUCT_REGISTRY_CONTRACT =
  "creditex-official-products/v1" as const;
export const CREDITEX_OFFICIAL_PRODUCT_REGISTRY_REVIEWED_ON = "2026-08-09";

export const CREDITEX_OFFICIAL_PRODUCT_KINDS = [
  "pv_module",
  "inverter",
  "battery",
  "cec_battery",
  "sres_air_source_heat_pump",
  "sres_solar_water_heater",
  "nsw_heat_pump_water_heater",
  "nsw_solar_water_heater",
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
  "veu_water_heater",
  "veu_air_conditioner",
  "veu_double_glazing",
  "veu_secondary_glazing",
  "veu_weather_sealing",
  "veu_shower_rose",
  "veu_refrigerator_freezer_listing",
  "veu_television_listing",
  "veu_clothes_dryer_listing",
  "veu_pool_pump",
  "veu_ceiling_insulation",
  "veu_activity_27_product",
  "veu_in_home_display",
  "veu_refrigerated_display_cabinet",
  "veu_activity_33_product",
  "veu_commercial_lighting",
  "veu_activity_35_product",
  "veu_activity_36_product",
  "veu_commercial_water_heater",
  "veu_induction_cooktop",
  "veu_project_based_lighting_product",
  "veu_unclassified_product",
  "wa_synergy_supported_solution",
  "wa_horizon_supported_solution",
] as const;

export type CreditexOfficialProductKind =
  typeof CREDITEX_OFFICIAL_PRODUCT_KINDS[number];

export const CREDITEX_SRES_OFFICIAL_PRODUCT_KINDS = [
  "sres_air_source_heat_pump",
  "sres_solar_water_heater",
] as const satisfies readonly CreditexOfficialProductKind[];

export type CreditexSresOfficialProductKind =
  typeof CREDITEX_SRES_OFFICIAL_PRODUCT_KINDS[number];

export const CREDITEX_PRODUCT_KIND_REGISTRY = {
  pv_module: "cer-cec-products",
  inverter: "cer-cec-products",
  battery: "cer-cec-products",
  cec_battery: "cec-products",
  sres_air_source_heat_pump: "cer_sres_swh",
  sres_solar_water_heater: "cer_sres_swh",
  nsw_heat_pump_water_heater: "nsw-tessa-products",
  nsw_solar_water_heater: "nsw-tessa-products",
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
  veu_water_heater: "veu-approved-products",
  veu_air_conditioner: "veu-approved-products",
  veu_double_glazing: "veu-approved-products",
  veu_secondary_glazing: "veu-approved-products",
  veu_weather_sealing: "veu-approved-products",
  veu_shower_rose: "veu-approved-products",
  veu_refrigerator_freezer_listing: "veu-approved-products",
  veu_television_listing: "veu-approved-products",
  veu_clothes_dryer_listing: "veu-approved-products",
  veu_pool_pump: "veu-approved-products",
  veu_ceiling_insulation: "veu-approved-products",
  veu_activity_27_product: "veu-approved-products",
  veu_in_home_display: "veu-approved-products",
  veu_refrigerated_display_cabinet: "veu-approved-products",
  veu_activity_33_product: "veu-approved-products",
  veu_commercial_lighting: "veu-approved-products",
  veu_activity_35_product: "veu-approved-products",
  veu_activity_36_product: "veu-approved-products",
  veu_commercial_water_heater: "veu-approved-products",
  veu_induction_cooktop: "veu-approved-products",
  veu_project_based_lighting_product: "veu-approved-products",
  veu_unclassified_product: "veu-approved-products",
  wa_synergy_supported_solution: "wa-synergy-supported-solutions",
  wa_horizon_supported_solution: "wa-horizon-supported-solutions",
} as const satisfies Record<CreditexOfficialProductKind, string>;

export const CREDITEX_PRODUCT_REGISTRY_FLEET_LEASE_CODE =
  "automatic-registry-fleet";

export type CreditexProductRegistryRefreshDesign = Readonly<{
  registryCode: string;
  producer:
    | "official_product_registry"
    | "cer_sres_registry"
    | "licensed_cec_battery_registry"
    | "controlled_official_import"
    | "blocked_external_source";
  refreshMode:
    | "automatic"
    | "licensed_automatic"
    | "governed_manual"
    | "blocked";
  requiredConfiguration: readonly string[];
  controlledImportPath: string | null;
}>;

/**
 * The complete executable acquisition inventory for every registry referenced
 * by a live calculator product kind. Keep this derived contract beside the
 * product-kind mapping so a new dependency cannot be added without declaring
 * how it is refreshed or governed.
 */
export const CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS = {
  "cer-cec-products": {
    registryCode: "cer-cec-products",
    producer: "controlled_official_import",
    refreshMode: "governed_manual",
    requiredConfiguration: ["CEC third-party content reuse approval"],
    controlledImportPath: "/api/creditex/official-products/controlled-import",
  },
  "cec-products": {
    registryCode: "cec-products",
    producer: "licensed_cec_battery_registry",
    refreshMode: "licensed_automatic",
    requiredConfiguration: [
      "CREDITEX_CEC_BATTERY_API_USERNAME",
      "CREDITEX_CEC_BATTERY_API_PASSWORD",
      "CREDITEX_CEC_BATTERY_LICENCE_REFERENCE",
    ],
    controlledImportPath: null,
  },
  cer_sres_swh: {
    registryCode: "cer_sres_swh",
    producer: "cer_sres_registry",
    refreshMode: "automatic",
    requiredConfiguration: [],
    controlledImportPath: null,
  },
  "nsw-tessa-products": {
    registryCode: "nsw-tessa-products",
    producer: "official_product_registry",
    refreshMode: "automatic",
    requiredConfiguration: [],
    controlledImportPath: null,
  },
  "gems-products": {
    registryCode: "gems-products",
    producer: "official_product_registry",
    refreshMode: "automatic",
    requiredConfiguration: [],
    controlledImportPath: null,
  },
  "veu-approved-products": {
    registryCode: "veu-approved-products",
    producer: "official_product_registry",
    refreshMode: "automatic",
    requiredConfiguration: [],
    controlledImportPath: null,
  },
  "wa-synergy-supported-solutions": {
    registryCode: "wa-synergy-supported-solutions",
    producer: "controlled_official_import",
    refreshMode: "governed_manual",
    requiredConfiguration: ["Synergy commercial reuse approval"],
    controlledImportPath: "/api/creditex/official-products/controlled-import",
  },
  "wa-horizon-supported-solutions": {
    registryCode: "wa-horizon-supported-solutions",
    producer: "blocked_external_source",
    refreshMode: "blocked",
    requiredConfiguration: [
      "Horizon Power supported export or authorised acquisition access",
    ],
    controlledImportPath: null,
  },
} as const satisfies Record<string, CreditexProductRegistryRefreshDesign>;

export type CreditexCalculatorProductRegistryCode =
  keyof typeof CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS;

export const CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES = [
  ...new Set(Object.values(CREDITEX_PRODUCT_KIND_REGISTRY)),
].sort() as readonly CreditexCalculatorProductRegistryCode[];

for (const registryCode of CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES) {
  if (!Object.hasOwn(CREDITEX_PRODUCT_REGISTRY_REFRESH_DESIGNS, registryCode)) {
    throw new Error(
      `Missing official product registry refresh design for ${registryCode}.`,
    );
  }
}

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
  | "OFFICIAL_PRODUCT_FLEET_BUSY"
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
  if (programCode === "SRES" && activityCode === "ASHP") {
    return ["sres_air_source_heat_pump"];
  }
  if (programCode === "SRES" && activityCode === "SWH") {
    return ["sres_solar_water_heater"];
  }
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
    } else if (kind === "cec_battery") {
      kinds.add("cec_battery");
    } else if (kind === "heat_pump_water_heater") {
      kinds.add("nsw_heat_pump_water_heater");
    } else if (kind === "solar_water_heater") {
      kinds.add("nsw_solar_water_heater");
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
    && kind !== "cec_battery"
    && kind !== "heat_pump_water_heater"
    && kind !== "solar_water_heater"
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
  BESS1: [
    "nominal_battery_capacity_kwh",
    "product_registry_eligibility_confirmed",
  ],
  BESS2: [
    "nominal_battery_capacity_kwh",
    "product_registry_eligibility_confirmed",
  ],
  BESS3: [
    "nominal_battery_capacity_kwh",
    "battery_inverter_output_kw",
    "product_registry_eligibility_confirmed",
  ],
  BESS4: [
    "nominal_battery_capacity_kwh",
    "battery_inverter_output_kw",
    "product_registry_eligibility_confirmed",
  ],
  D17: [
    "system_size",
    "annual_supplementary_energy_gj",
    "annual_auxiliary_electricity_gj",
    "product_registry_eligibility_confirmed",
  ],
  D18: [
    "system_size",
    "annual_supplementary_energy_gj",
    "annual_auxiliary_electricity_gj",
    "product_registry_eligibility_confirmed",
  ],
  D19: [
    "system_size",
    "annual_supplementary_energy_gj",
    "annual_auxiliary_electricity_gj",
    "product_registry_eligibility_confirmed",
  ],
  D20: [
    "system_size",
    "annual_supplementary_energy_gj",
    "annual_auxiliary_electricity_gj",
    "product_registry_eligibility_confirmed",
  ],
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

function officialBoolean(
  selection: CreditexFormulaProductSelection,
  key: string,
  label: string,
) {
  const value = selection.attributes[key];
  if (typeof value !== "boolean") {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(selection.productKind)} does not publish ${label}. Choose another current product or refresh the official source.`,
    );
  }
  return value;
}

const SIMPLE_LIGHTING_CONTROL_PROFILES = new Set([
  "none",
  "occupancy_1_to_2",
  "occupancy_3_to_6",
  "occupancy_more_than_6",
  "programmable_dimmer",
  "occupancy_1_to_2_and_programmable_dimmer",
  "occupancy_3_to_6_and_programmable_dimmer",
  "occupancy_more_than_6_and_programmable_dimmer",
]);

function exactSimpleLightingControlProfile(
  selection: CreditexFormulaProductSelection,
  callerValue: unknown,
) {
  if (
    typeof callerValue !== "string"
    || !SIMPLE_LIGHTING_CONTROL_PROFILES.has(callerValue)
  ) {
    return officialProductFailure(
      "Select the exact installed occupancy-sensor coverage and programmable-dimmer configuration for the approved lighting product.",
    );
  }
  const sourceOccupancy = officialBoolean(
    selection,
    "occupancySensor",
    "an exact occupancy-sensor flag",
  );
  const sourceProgrammable = officialBoolean(
    selection,
    "programmableDimmer",
    "an exact programmable-dimmer flag",
  );
  const selectedOccupancy = callerValue.startsWith("occupancy_");
  const selectedProgrammable = callerValue.includes("programmable_dimmer");
  if (
    sourceOccupancy !== selectedOccupancy
    || sourceProgrammable !== selectedProgrammable
  ) {
    return officialProductFailure(
      `The selected lighting control profile does not match the approved product flags (occupancy sensor ${sourceOccupancy ? "yes" : "no"}; programmable dimmer ${sourceProgrammable ? "yes" : "no"}). Select the exact installed occupancy coverage without changing the approved control capabilities.`,
    );
  }
  return callerValue;
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

function deriveNswTessaWaterHeaterInputs(
  activityCode: "D17" | "D18" | "D19" | "D20",
  inputs: Record<string, unknown>,
  selections: readonly CreditexFormulaProductSelection[],
) {
  const heatPump = activityCode === "D17" || activityCode === "D19";
  const selection = selectedProduct(
    selections,
    heatPump
      ? "nsw_heat_pump_water_heater"
      : "nsw_solar_water_heater",
  );
  const acceptedActivities = officialText(
    selection,
    "tessaAcceptedActivities",
    "an exact TESSA accepted-activity set",
  ).split(",");
  if (!acceptedActivities.includes(activityCode)) {
    return officialProductFailure(
      `The selected TESSA product is not accepted for activity ${activityCode}.`,
    );
  }
  const callerSystemSize = inputs.system_size;
  if (callerSystemSize !== "small" && callerSystemSize !== "medium") {
    return officialProductFailure(
      "Select the exact small or medium AS/NZS 4234 system size before resolving TESSA product data.",
    );
  }
  let zone: "3" | "5" = "3";
  if (heatPump) {
    const bcaClimateZone = String(inputs.bca_climate_zone || "");
    if (!/^[2-8]$/.test(bcaClimateZone)) {
      return officialProductFailure(
        "Select the exact BCA climate zone 2 to 8 before resolving the TESSA heat-pump values.",
      );
    }
    zone = Number(bcaClimateZone) >= 7 ? "5" : "3";
  }
  const acceptedSystemSize = officialText(
    selection,
    `zone${zone}SystemSize`,
    `a TESSA zone ${zone} system size`,
  );
  const normalizedAcceptedSize = acceptedSystemSize === "Small"
    ? "small"
    : acceptedSystemSize === "Medium"
      ? "medium"
      : officialProductFailure(
          `The selected TESSA product publishes unsupported zone ${zone} system size ${JSON.stringify(acceptedSystemSize)}.`,
        );
  if (normalizedAcceptedSize !== callerSystemSize) {
    return officialProductFailure(
      `The selected TESSA product is ${acceptedSystemSize} for zone ${zone}, not ${callerSystemSize}.`,
    );
  }
  inputs.system_size = normalizedAcceptedSize;
  setOfficialNumber(
    inputs,
    "annual_supplementary_energy_gj",
    officialNumber(
      selection,
      `zone${zone}BsGjPerYear`,
      `TESSA zone ${zone} annual supplementary energy (Bs)`,
      { allowZero: true },
    ),
  );
  setOfficialNumber(
    inputs,
    "annual_auxiliary_electricity_gj",
    officialNumber(
      selection,
      `zone${zone}BeGjPerYear`,
      `TESSA zone ${zone} annual auxiliary electricity (Be)`,
      { allowZero: true },
    ),
  );
  inputs.product_registry_eligibility_confirmed = "yes";
  return inputs;
}

export function deriveCreditexNswOfficialProductInputs(
  programCode: string,
  activityCode: string,
  callerInputs: Record<string, unknown>,
  selections: readonly CreditexFormulaProductSelection[],
) {
  const inputs = { ...callerInputs };
  if (["BESS1", "BESS2", "BESS3", "BESS4"].includes(activityCode)) {
    const selection = selectedProduct(selections, "cec_battery");
    const nominalCapacity = officialNumber(
      selection,
      "nominalBatteryCapacityKwh",
      "CEC nominal battery capacity",
    );
    // The licensed response also publishes its own usable-capacity field. It
    // is required as source evidence, but PDRS clause 10 defines the governed
    // calculation value independently as 90% of nominal capacity.
    officialNumber(
      selection,
      "cecPublishedUsableCapacityKwh",
      "CEC published usable battery capacity",
    );
    setOfficialNumber(
      inputs,
      "nominal_battery_capacity_kwh",
      nominalCapacity,
    );
    if (activityCode === "BESS3" || activityCode === "BESS4") {
      setOfficialNumber(
        inputs,
        "battery_inverter_output_kw",
        officialNumber(
          selection,
          "pdrsBatteryInverterOutputKw",
          "PDRS Battery Inverter Output",
        ),
      );
    }
    inputs.product_registry_eligibility_confirmed = "yes";
    return inputs;
  }
  if (
    activityCode === "D17"
    || activityCode === "D18"
    || activityCode === "D19"
    || activityCode === "D20"
  ) {
    return deriveNswTessaWaterHeaterInputs(
      activityCode,
      inputs,
      selections,
    );
  }
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
  const scenario = officialText(
    selection,
    "veuProductCategoryNumber",
    "an exact VEU product category number",
  );
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
  if (["1C", "1D", "3C", "3D"].includes(activityCode)) {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_water_heater");
    const sourceSize = officialText(
      selection,
      "veuSystemSize",
      "an exact VEU system size",
    );
    const systemSize = sourceSize === "Small"
      ? "small"
      : sourceSize === "Medium"
        ? "medium"
        : officialProductFailure(
          `The selected VEU-approved water heater publishes unsupported system size ${JSON.stringify(sourceSize)}.`,
        );
    const climateZone = inputs.climate_zone;
    if (climateZone !== "4" && climateZone !== "5") {
      return officialProductFailure(
        "Resolve the exact VEU climate zone from the installation postcode before selecting water-heater model data.",
      );
    }
    if ((activityCode === "1C" || activityCode === "3D") && climateZone !== "4") {
      return officialProductFailure(
        `VEU activity ${activityCode} uses only the approved model's climate-zone 4 values.`,
      );
    }
    if (activityCode === "1C" && systemSize === "medium") {
      return officialProductFailure(
        "VEU activity 1C medium is disabled because Specification v25 Table 1.4 and the ESC product application guide conflict on the required Be2021 load. Small 1C systems remain available.",
      );
    }
    if ((activityCode === "3C" || activityCode === "3D") && systemSize !== "medium") {
      return officialProductFailure(
        `VEU activity ${activityCode} is defined only for a medium system; the selected product is ${sourceSize}.`,
      );
    }
    const annualEnergySavings = officialNumber(
      selection,
      `zone${climateZone}AnnualEnergySavings`,
      `zone ${climateZone} annual energy savings`,
      { allowZero: true },
    );
    if (annualEnergySavings < 60) {
      return officialProductFailure(
        `The selected water heater records ${annualEnergySavings}% annual energy savings in climate zone ${climateZone}; VEU activity ${activityCode} requires at least 60%.`,
      );
    }
    const prefix = `bs2021Zone${climateZone}StepDownLoadGjPerYear`;
    const bePrefix = `be2021Zone${climateZone}StepDownLoadGjPerYear`;
    setOfficialNumber(
      inputs,
      "bs2021_gj_per_year",
      officialNumber(selection, prefix, `zone ${climateZone} step-down Bs2021`, {
        allowZero: true,
      }),
    );
    setOfficialNumber(
      inputs,
      "be2021_gj_per_year",
      officialNumber(selection, bePrefix, `zone ${climateZone} step-down Be2021`, {
        allowZero: true,
      }),
    );
    if (activityCode === "1C" || activityCode === "1D") {
      inputs.system_size = systemSize;
    }
    return inputs;
  }
  if (activityCode === "6") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_air_conditioner");
    const category = officialText(
      selection,
      "veuProductCategoryNumber",
      "an exact VEU product category number",
    );
    const sourceConfiguration = officialText(
      selection,
      "veuProductConfiguration",
      "an exact VEU product configuration",
    );
    const configurationClass = officialText(
      selection,
      "veuProductConfigurationClass",
      "a governed VEU product configuration class",
    );
    if (
      configurationClass !== "single"
      && configurationClass !== "multi"
      && configurationClass !== "packaged"
    ) {
      return officialProductFailure(
        `The selected VEU air conditioner has unsupported configuration ${JSON.stringify(sourceConfiguration)}.`,
      );
    }
    const premises = inputs.premises;
    if (premises !== "residential" && premises !== "business") {
      return officialProductFailure(
        "Select the governed residential or business premises type before resolving approved seasonal-performance data.",
      );
    }
    const locationClass = inputs.location_class;
    if (
      typeof locationClass !== "string"
      || ![
        "metro_mild",
        "metro_cold",
        "regional_mild",
        "regional_cold",
        "regional_hot",
      ].includes(locationClass)
    ) {
      return officialProductFailure(
        "Resolve the exact VEU climatic location from the installation postcode before selecting seasonal-performance data.",
      );
    }
    const premisesSuffix = premises === "residential" ? "Residential" : "Commercial";
    const metric = (
      measure: "Hspf" | "Tcspf",
      climate: "Cold" | "Mixed",
    ) => {
      const gems = optionalPositiveNumber(
        selection,
        `gems${measure}${climate}${premisesSuffix}`,
      );
      if (gems !== null) return { value: gems, basis: "gems" as const };
      const calculated = optionalPositiveNumber(
        selection,
        `calculated${measure}${climate}${premisesSuffix}`,
      );
      if (calculated !== null) {
        return { value: calculated, basis: "calculated" as const };
      }
      return officialProductFailure(
        `The selected VEU-approved air conditioner publishes neither a positive GEMS nor calculated ${measure.toUpperCase()} for ${climate.toLowerCase()} ${premises} use.`,
      );
    };
    const applicableClimate = locationClass === "regional_hot" ? "Mixed" : "Cold";
    const applicableHspf = metric("Hspf", applicableClimate);
    const applicableTcspf = metric("Tcspf", applicableClimate);
    const coldHspf = metric("Hspf", "Cold");
    const coldTcspf = metric("Tcspf", "Cold");
    const bases = new Set([
      applicableHspf.basis,
      applicableTcspf.basis,
      coldHspf.basis,
      coldTcspf.basis,
    ]);
    const refrigerant = officialText(
      selection,
      "refrigerantType",
      "an exact refrigerant type",
    );
    const refrigerantGwp = refrigerant === "R-32"
      ? 675
      : refrigerant === "R-410A"
        ? 2088
        : officialProductFailure(
          `The selected VEU-approved air conditioner uses unsupported refrigerant ${JSON.stringify(refrigerant)}.`,
        );
    const approvedHeatingCapacity = officialNumber(
      selection,
      "ratedHeatingCapacityKw",
      "rated heating capacity",
    );
    const approvedCoolingCapacity = officialNumber(
      selection,
      "ratedCoolingCapacityKw",
      "rated cooling capacity",
    );
    inputs.category = category;
    inputs.configuration = configurationClass;
    if (configurationClass !== "multi") {
      setOfficialNumber(
        inputs,
        "rated_heating_capacity_kw",
        approvedHeatingCapacity,
      );
      setOfficialNumber(
        inputs,
        "rated_cooling_capacity_kw",
        approvedCoolingCapacity,
      );
      delete inputs.outdoor_heating_capacity_kw;
      delete inputs.outdoor_cooling_capacity_kw;
      delete inputs.same_oem_confirmed;
    } else {
      setOfficialNumber(
        inputs,
        "outdoor_heating_capacity_kw",
        approvedHeatingCapacity,
      );
      setOfficialNumber(
        inputs,
        "outdoor_cooling_capacity_kw",
        approvedCoolingCapacity,
      );
    }
    setOfficialNumber(inputs, "hspf_upgrade", applicableHspf.value);
    setOfficialNumber(inputs, "tcspf_upgrade", applicableTcspf.value);
    setOfficialNumber(inputs, "hspf_cold_eligibility", coldHspf.value);
    setOfficialNumber(inputs, "tcspf_cold_eligibility", coldTcspf.value);
    setOfficialNumber(inputs, "refrigerant_gwp", refrigerantGwp);
    inputs.performance_basis = bases.size === 1
      ? bases.has("gems") ? "gems" : "calculated_from_acop_aeer"
      : "mixed_gems_and_calculated";
    return inputs;
  }
  if (activityCode === "13") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_double_glazing");
    setOfficialNumber(
      inputs,
      "wers_heating_stars",
      officialNumber(selection, "wersHeatingStars", "WERS heating star rating"),
    );
    return inputs;
  }
  if (activityCode === "14") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    return officialProductFailure(
      "No current or Legacy Part 14 row exists in the reviewed VEU Public Registry, so its product-type vocabulary cannot yet be normalized safely.",
    );
  }
  if (activityCode === "15") {
    const callerScenario = inputs.scenario;
    if (
      typeof callerScenario !== "string"
      || !/^15[A-H]$/.test(callerScenario)
    ) {
      return officialProductFailure(
        "Select the exact VEU Part 15 weather-sealing scenario before resolving approved-product evidence.",
      );
    }
    assertCreditexVeuOfficialProductSelections(
      activityCode,
      selections,
      callerScenario,
    );
    const selection = selectedProduct(selections, "veu_weather_sealing");
    const scenario = officialText(
      selection,
      "veuProductCategoryNumber",
      "an exact VEU product category number",
    );
    if (scenario !== callerScenario) {
      return officialProductFailure(
        `The selected VEU weather-sealing product is category ${scenario}, not ${callerScenario}.`,
      );
    }
    inputs.scenario = scenario;
    if (scenario === "15F" || scenario === "15G") {
      delete inputs.warranty_years;
    } else {
      setOfficialNumber(
        inputs,
        "warranty_years",
        officialNumber(selection, "warrantyYears", "product warranty period"),
      );
    }
    return inputs;
  }
  if (activityCode === "26") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_pool_pump");
    setOfficialNumber(
      inputs,
      "paec_kwh_per_year",
      officialNumber(
        selection,
        "paecKwhPerYear",
        "projected annual energy consumption",
      ),
    );
    return inputs;
  }
  if (activityCode === "27" || activityCode === "35") {
    const scenario = inputs.scenario;
    if (typeof scenario !== "string" || !scenario.startsWith(activityCode)) {
      return officialProductFailure(
        `Select the exact VEU Part ${activityCode} scenario before resolving approved-product evidence.`,
      );
    }
    assertCreditexVeuOfficialProductSelections(activityCode, selections, scenario);
    if (
      (activityCode === "27" && scenario === "27C")
      || (activityCode === "35" && (scenario === "35C" || scenario === "35D"))
    ) {
      return inputs;
    }
    const selection = selectedProduct(
      selections,
      activityCode === "27"
        ? "veu_activity_27_product"
        : "veu_activity_35_product",
    );
    inputs.approved_upgrade_control_profile = exactSimpleLightingControlProfile(
      selection,
      inputs.approved_upgrade_control_profile,
    );
    if (scenario === "27B") {
      setOfficialNumber(
        inputs,
        "approved_upgrade_lcp_w",
        officialNumber(
          selection,
          "victorianLampCircuitPowerW",
          "Victorian-load lamp circuit power",
        ),
      );
    }
    if (scenario === "35B") {
      setOfficialNumber(
        inputs,
        "approved_upgrade_lcp_w",
        officialNumber(selection, "lampCircuitPowerW", "lamp circuit power"),
      );
      const ratedLifetime = optionalPositiveNumber(
        selection,
        "reportedLifetimeL70Hours",
      );
      if (ratedLifetime !== null) {
        setOfficialNumber(inputs, "upgrade_rated_lifetime_hours", ratedLifetime);
      } else if (inputs.replacement_method === "retrofit") {
        return officialProductFailure(
          "The selected VEU Part 35 retrofit product does not publish a positive L70 lifetime.",
        );
      }
    }
    return inputs;
  }
  if (activityCode === "34") {
    const scenario = inputs.scenario;
    if (typeof scenario !== "string" || !scenario.startsWith("34")) {
      return officialProductFailure(
        "Select the exact VEU Part 34 scenario before resolving approved-product evidence.",
      );
    }
    assertCreditexVeuOfficialProductSelections(activityCode, selections, scenario);
    if (scenario === "34D" || scenario === "34E") return inputs;
    const selection = selectedProduct(selections, "veu_commercial_lighting");
    const occupancy = officialBoolean(
      selection,
      "occupancySensor",
      "an exact occupancy-sensor flag",
    );
    const occupancyScope = inputs.approved_upgrade_occupancy_sensor_scope;
    if (occupancy) {
      if (
        occupancyScope !== "one_to_two_luminaires"
        && occupancyScope !== "three_to_six_luminaires"
        && occupancyScope !== "more_than_six_luminaires"
      ) {
        return officialProductFailure(
          "The approved Part 34 product includes an occupancy sensor. Select the evidenced number of luminaires controlled by each installed sensor.",
        );
      }
    } else {
      inputs.approved_upgrade_occupancy_sensor_scope = "none";
    }
    for (const [inputKey, attributeKey, label] of [
      ["approved_upgrade_daylight_linked_control", "daylightLinkedControl", "daylight-linked control"],
      ["approved_upgrade_programmable_dimmer", "programmableDimmer", "programmable dimmer"],
      ["approved_upgrade_manual_dimmer", "manualDimmer", "manual dimmer"],
      ["approved_upgrade_voltage_reduction_unit", "voltageReductionUnit", "voltage reduction unit"],
    ] as const) {
      inputs[inputKey] = officialBoolean(selection, attributeKey, `an exact ${label} flag`)
        ? "yes"
        : "no";
    }
    if (scenario === "34B") {
      setOfficialNumber(
        inputs,
        "approved_upgrade_voltage_reduction_unit_output_v",
        officialNumber(
          selection,
          "voltageReductionUnitOutputV",
          "voltage-reduction-unit output voltage",
        ),
      );
    } else {
      delete inputs.approved_upgrade_voltage_reduction_unit_output_v;
    }
    if (scenario === "34C") {
      const approvedLcp = optionalPositiveNumber(selection, "lampCircuitPowerW")
        ?? optionalPositiveNumber(selection, "nominalLampPowerW");
      if (approvedLcp === null) {
        return officialProductFailure(
          "The selected VEU Part 34C product publishes neither a positive lamp circuit power nor nominal lamp power.",
        );
      }
      setOfficialNumber(inputs, "approved_upgrade_lcp_w", approvedLcp);
      const ratedLifetime = optionalPositiveNumber(
        selection,
        "reportedLifetimeL70Hours",
      );
      if (ratedLifetime !== null) {
        setOfficialNumber(inputs, "upgrade_rated_lifetime_hours", ratedLifetime);
      } else if (inputs.replacement_method === "retrofit") {
        return officialProductFailure(
          "The selected VEU Part 34C retrofit product does not publish a positive L70 lifetime.",
        );
      }
    }
    return inputs;
  }
  if (activityCode === "30") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_in_home_display");
    inputs.scenario = officialText(
      selection,
      "veuProductCategoryNumber",
      "an exact VEU product category number",
    );
    return inputs;
  }
  if (activityCode === "31") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "electric_motor");
    inputs.scenario = "31A";
    setOfficialNumber(
      inputs,
      "rated_output_kw",
      officialNumber(selection, "ratedOutputKw", "GEMS rated motor output"),
    );
    return inputs;
  }
  if (activityCode === "33") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_activity_33_product");
    const rotor = officialText(
      selection,
      "rotorMotorType",
      "an exact rotor motor type",
    );
    inputs.scenario = "33A";
    inputs.rotor_motor_type = rotor === "Internal"
      ? "internal"
      : rotor === "External"
        ? "external"
        : officialProductFailure(
          `The selected VEU activity 33 product publishes unsupported rotor type ${JSON.stringify(rotor)}.`,
        );
    setOfficialNumber(
      inputs,
      "input_power_w",
      officialNumber(selection, "inputPowerW", "nameplate fan input power"),
    );
    setOfficialNumber(
      inputs,
      "output_power_w",
      officialNumber(selection, "outputPowerW", "rated motor output power"),
    );
    return inputs;
  }
  if (activityCode === "36") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    selectedProduct(selections, "veu_activity_36_product");
    return inputs;
  }
  if (activityCode === "44") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_commercial_water_heater");
    const climateZone = inputs.climate_zone;
    if (climateZone !== "4" && climateZone !== "5") {
      return officialProductFailure(
        "Resolve climate zone 4 or 5 from the installation postcode before selecting Part 44 model outputs.",
      );
    }
    const prefix = `zone${climateZone}`;
    setOfficialNumber(
      inputs,
      "number_of_heat_pumps",
      officialNumber(selection, "numberOfHeatPumps", "number of heat pumps"),
    );
    setOfficialNumber(
      inputs,
      "number_of_tanks",
      officialNumber(selection, "numberOfTanks", "number of tanks"),
    );
    setOfficialNumber(
      inputs,
      "total_heat_pump_thermal_capacity_kw",
      officialNumber(
        selection,
        "totalHeatPumpThermalCapacityKw",
        "total heat-pump thermal capacity",
      ),
    );
    setOfficialNumber(
      inputs,
      "total_storage_volume_litres",
      officialNumber(
        selection,
        "totalSystemTankVolumeLitres",
        "total system tank volume",
      ),
    );
    setOfficialNumber(
      inputs,
      "annual_energy_savings_percent",
      officialNumber(
        selection,
        `${prefix}AnnualEnergySavings`,
        `zone ${climateZone} annual energy savings`,
      ),
    );
    setOfficialNumber(
      inputs,
      "commercial_peak_load_mj_per_day",
      officialNumber(
        selection,
        `${prefix}CommercialPeakLoadMjPerDay`,
        `zone ${climateZone} commercial peak load`,
      ),
    );
    setOfficialNumber(
      inputs,
      "hp_electricity_gj_per_year",
      officialNumber(
        selection,
        `${prefix}HpElectricityGjPerYear`,
        `zone ${climateZone} heat-pump electricity`,
        { allowZero: true },
      ),
    );
    setOfficialNumber(
      inputs,
      "hp_gas_gj_per_year",
      officialNumber(
        selection,
        `${prefix}HpGasGjPerYear`,
        `zone ${climateZone} heat-pump gas`,
        { allowZero: true },
      ),
    );
    const refrigerant = officialText(
      selection,
      "refrigerantType",
      "an exact refrigerant type",
    );
    const refrigerantGwp = ({
      "R-744": 1,
      "R-513A": 629,
      "R-1234yf": 5,
      "R-290": 3,
    } as const)[refrigerant as "R-744" | "R-513A" | "R-1234yf" | "R-290"];
    if (!refrigerantGwp) {
      return officialProductFailure(
        `The selected VEU Part 44 product uses refrigerant ${JSON.stringify(refrigerant)}, which is not in the reviewed ESC Application Guide v2.2 GWP table.`,
      );
    }
    setOfficialNumber(inputs, "refrigerant_gwp", refrigerantGwp);
    setOfficialNumber(
      inputs,
      "refrigerant_charge_kg",
      officialNumber(selection, "refrigerantChargeKg", "refrigerant charge"),
    );
    return inputs;
  }
  if (activityCode === "22") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(
      selections,
      "veu_refrigerator_freezer_listing",
    );
    inputs.scenario = derivedVeu22Scenario(selection);
    return inputs;
  }
  if (activityCode === "24") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_television_listing");
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
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_clothes_dryer_listing");
    const starRating = officialNumber(selection, "starRating", "star rating");
    const capacity = officialNumber(selection, "capacityKg", "drying capacity");
    if (starRating < 7 || capacity < 5) {
      officialProductFailure(
        `VEU activity 25 requires at least 7 stars and 5 kg capacity; the selected dryer records ${starRating} stars and ${capacity} kg.`,
      );
    }
    inputs.scenario = "25A";
    return inputs;
  }
  if (activityCode === "48") {
    const scenario = inputs.scenario;
    if (
      scenario !== "48A(i)"
      && scenario !== "48A(ii)"
      && scenario !== "48B(i)"
      && scenario !== "48B(ii)"
    ) {
      return officialProductFailure(
        "Select the exact VEU Part 48 installation scenario before resolving approved insulation evidence.",
      );
    }
    assertCreditexVeuOfficialProductSelections(
      activityCode,
      selections,
      scenario,
    );
    return inputs;
  }
  if (activityCode === "46") {
    assertCreditexVeuOfficialProductSelections(activityCode, selections);
    const selection = selectedProduct(selections, "veu_induction_cooktop");
    inputs.scenario = officialText(
      selection,
      "veuProductCategoryNumber",
      "an exact VEU product category number",
    );
    return inputs;
  }
  return inputs;
}

type CreditexVeuActivityProductContract = {
  productKinds: readonly CreditexOfficialProductKind[];
  veuProductCategoryNumbers: readonly string[];
};

const CREDITEX_VEU_SCENARIO_PRODUCT_CONTRACTS = {
  "15A": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15A"],
  },
  "15B": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15B"],
  },
  "15C": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15C"],
  },
  "15D": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15D"],
  },
  "15E": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15E"],
  },
  "15F": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15F"],
  },
  "15G": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15G"],
  },
  "15H": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: ["15H"],
  },
  "27A": {
    productKinds: ["veu_activity_27_product"],
    veuProductCategoryNumbers: ["27A"],
  },
  "27B": {
    productKinds: ["veu_activity_27_product"],
    veuProductCategoryNumbers: ["27B"],
  },
  "27C": { productKinds: [], veuProductCategoryNumbers: [] },
  "34A": {
    productKinds: ["veu_commercial_lighting"],
    veuProductCategoryNumbers: ["34A"],
  },
  "34B": {
    productKinds: ["veu_commercial_lighting"],
    veuProductCategoryNumbers: ["34B"],
  },
  "34C": {
    productKinds: ["veu_commercial_lighting"],
    veuProductCategoryNumbers: ["34C"],
  },
  "34D": { productKinds: [], veuProductCategoryNumbers: [] },
  "34E": { productKinds: [], veuProductCategoryNumbers: [] },
  "35A": {
    productKinds: ["veu_activity_35_product"],
    veuProductCategoryNumbers: ["35A"],
  },
  "35B": {
    productKinds: ["veu_activity_35_product"],
    veuProductCategoryNumbers: ["35B"],
  },
  "35C": { productKinds: [], veuProductCategoryNumbers: [] },
  "35D": { productKinds: [], veuProductCategoryNumbers: [] },
  "48A(i)": {
    productKinds: ["veu_ceiling_insulation"],
    veuProductCategoryNumbers: ["48A"],
  },
  "48A(ii)": {
    productKinds: ["veu_ceiling_insulation"],
    veuProductCategoryNumbers: ["48A"],
  },
  "48B(i)": {
    productKinds: ["veu_ceiling_insulation"],
    veuProductCategoryNumbers: ["48B"],
  },
  "48B(ii)": {
    productKinds: ["veu_ceiling_insulation"],
    veuProductCategoryNumbers: ["48B"],
  },
} as const satisfies Record<string, CreditexVeuActivityProductContract>;

export const CREDITEX_VEU_ACTIVITY_PRODUCT_CONTRACTS = {
  "1C": {
    productKinds: ["veu_water_heater"],
    veuProductCategoryNumbers: ["1C"],
  },
  "1D": {
    productKinds: ["veu_water_heater"],
    veuProductCategoryNumbers: ["1D"],
  },
  "3C": {
    productKinds: ["veu_water_heater"],
    veuProductCategoryNumbers: ["3C"],
  },
  "3D": {
    productKinds: ["veu_water_heater"],
    veuProductCategoryNumbers: ["3D"],
  },
  "6": {
    productKinds: ["veu_air_conditioner"],
    veuProductCategoryNumbers: [
      "6A",
      "6B(i)",
      "6B(ii)",
      "6C",
      "6D",
      "6E(i)",
      "6E(ii)",
      "6F",
      "6G",
    ],
  },
  "13": {
    productKinds: ["veu_double_glazing"],
    veuProductCategoryNumbers: ["13A"],
  },
  "14": {
    productKinds: ["veu_secondary_glazing"],
    veuProductCategoryNumbers: ["14A"],
  },
  "15": {
    productKinds: ["veu_weather_sealing"],
    veuProductCategoryNumbers: [
      "15A",
      "15B",
      "15C",
      "15D",
      "15E",
      "15F",
      "15G",
      "15H",
    ],
  },
  "17": {
    productKinds: ["veu_shower_rose"],
    veuProductCategoryNumbers: ["17A"],
  },
  "22": {
    productKinds: ["veu_refrigerator_freezer_listing"],
    veuProductCategoryNumbers: ["22A", "22B", "22C", "22D"],
  },
  "24": {
    productKinds: ["veu_television_listing"],
    veuProductCategoryNumbers: ["24A"],
  },
  "25": {
    productKinds: ["veu_clothes_dryer_listing"],
    veuProductCategoryNumbers: ["25A"],
  },
  "26": {
    productKinds: ["veu_pool_pump"],
    veuProductCategoryNumbers: ["26A"],
  },
  "30": {
    productKinds: ["veu_in_home_display"],
    veuProductCategoryNumbers: ["30A", "30B"],
  },
  "31": {
    productKinds: ["electric_motor"],
    veuProductCategoryNumbers: [],
  },
  "33": {
    productKinds: ["veu_activity_33_product"],
    veuProductCategoryNumbers: ["33A"],
  },
  "36": {
    productKinds: ["veu_activity_36_product"],
    veuProductCategoryNumbers: ["36A"],
  },
  "44": {
    productKinds: ["veu_commercial_water_heater"],
    veuProductCategoryNumbers: ["44A"],
  },
  "46": {
    productKinds: ["veu_induction_cooktop"],
    veuProductCategoryNumbers: ["46A", "46B"],
  },
  "48": {
    productKinds: ["veu_ceiling_insulation"],
    veuProductCategoryNumbers: ["48A", "48B"],
  },
} as const satisfies Record<string, CreditexVeuActivityProductContract>;

function veuActivityProductContract(activityCode: string, scenario?: string) {
  if (
    (
      activityCode === "15"
      || activityCode === "27"
      || activityCode === "34"
      || activityCode === "35"
      || activityCode === "48"
    )
    && scenario
  ) {
    const scenarioContract = (
      CREDITEX_VEU_SCENARIO_PRODUCT_CONTRACTS as Readonly<
        Record<string, CreditexVeuActivityProductContract | undefined>
      >
    )[scenario];
    return scenarioContract && scenario.startsWith(activityCode)
      ? scenarioContract
      : undefined;
  }
  return (
    CREDITEX_VEU_ACTIVITY_PRODUCT_CONTRACTS as Readonly<
      Record<string, CreditexVeuActivityProductContract | undefined>
    >
  )[activityCode];
}

export function officialProductKindsForVeuActivity(
  activityCode: string,
  scenario?: string,
  installationDate?: string,
): readonly CreditexOfficialProductKind[] {
  if (
    activityCode === "46"
    && installationDate
    && installationDate >= "2026-06-30"
  ) {
    return [];
  }
  return veuActivityProductContract(activityCode, scenario)?.productKinds || [];
}

export function officialVeuProductCategoryNumbersForActivity(
  activityCode: string,
  scenario?: string,
): readonly string[] {
  return veuActivityProductContract(
    activityCode,
    scenario,
  )?.veuProductCategoryNumbers || [];
}

export function assertCreditexVeuOfficialProductSelections(
  activityCode: string,
  selections: readonly CreditexFormulaProductSelection[],
  scenario?: string,
) {
  const contract = veuActivityProductContract(activityCode, scenario);
  if (!contract) {
    return officialProductFailure(
      `Activity ${activityCode} has no governed VEU approved-product selection contract.`,
    );
  }
  const expectedKinds = new Set(contract.productKinds);
  const unexpected = selections.find(
    (selection) => !expectedKinds.has(selection.productKind),
  );
  if (unexpected) {
    return officialProductFailure(
      `The selected ${officialProductKindLabel(unexpected.productKind)} is not compatible with VEU activity ${activityCode}.`,
    );
  }
  for (const productKind of contract.productKinds) {
    const matching = selections.filter(
      (selection) => selection.productKind === productKind,
    );
    if (matching.length !== 1) {
      return officialProductFailure(
        `VEU activity ${activityCode} requires exactly one current official ${officialProductKindLabel(productKind)} selection.`,
      );
    }
    selectedProduct(selections, productKind);
  }
  const veuSelections = selections.filter(
    (selection) => CREDITEX_PRODUCT_KIND_REGISTRY[selection.productKind]
      === "veu-approved-products",
  );
  for (const selection of veuSelections) {
    const categoryNumber = officialText(
      selection,
      "veuProductCategoryNumber",
      "an exact VEU product category number",
    );
    if (!contract.veuProductCategoryNumbers.includes(categoryNumber)) {
      return officialProductFailure(
        `VEU product category ${JSON.stringify(categoryNumber)} is not compatible with activity ${activityCode}.`,
      );
    }
  }
  return selections;
}

export function officialProductKindLabel(kind: CreditexOfficialProductKind) {
  const labels: Record<CreditexOfficialProductKind, string> = {
    pv_module: "PV module",
    inverter: "inverter",
    battery: "battery",
    cec_battery: "CEC-approved battery",
    sres_air_source_heat_pump: "CER-registered air-source heat pump",
    sres_solar_water_heater: "CER-registered solar water heater",
    nsw_heat_pump_water_heater: "TESSA-accepted heat-pump water heater",
    nsw_solar_water_heater: "TESSA-accepted solar water heater",
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
    veu_water_heater: "VEU-approved water heater",
    veu_air_conditioner: "VEU-approved air conditioner",
    veu_double_glazing: "VEU-approved double-glazing product",
    veu_secondary_glazing: "VEU-approved secondary-glazing product",
    veu_weather_sealing: "VEU-approved weather-sealing product",
    veu_shower_rose: "VEU-approved shower rose",
    veu_refrigerator_freezer_listing: "VEU refrigerator or freezer listing",
    veu_television_listing: "VEU television listing",
    veu_clothes_dryer_listing: "VEU clothes-dryer listing",
    veu_pool_pump: "VEU-approved pool pump",
    veu_ceiling_insulation: "VEU-approved ceiling-insulation product",
    veu_activity_27_product: "VEU activity 27 product",
    veu_in_home_display: "VEU-approved in-home display",
    veu_refrigerated_display_cabinet: "VEU refrigerated display cabinet listing",
    veu_activity_33_product: "VEU activity 33 product",
    veu_commercial_lighting: "VEU-approved commercial-lighting product",
    veu_activity_35_product: "VEU activity 35 product",
    veu_activity_36_product: "VEU activity 36 product",
    veu_commercial_water_heater: "VEU-approved commercial water heater",
    veu_induction_cooktop: "VEU induction cooktop listing",
    veu_project_based_lighting_product: "VEU project-based lighting product",
    veu_unclassified_product: "unclassified VEU product record",
    wa_synergy_supported_solution: "Synergy supported solution",
    wa_horizon_supported_solution: "Horizon Power supported solution",
  };
  return labels[kind];
}
