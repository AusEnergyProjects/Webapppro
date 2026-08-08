export const CREDITEX_VEU_CATALOGUE_REVIEWED_ON = "2026-08-08" as const;

export const CREDITEX_VEU_SPECIFICATION_SOURCES = {
  v24: {
    version: "24.0",
    effectiveFrom: "2026-06-30",
    effectiveTo: "2026-07-20",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0031/792904/victorian-energy-upgrades-specifications-2018-version-24.pdf",
    title: "Victorian Energy Upgrades Specifications 2018 Version 24.0",
  },
  v25: {
    version: "25.0",
    effectiveFrom: "2026-07-21",
    effectiveTo: "",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
    title: "Victorian Energy Upgrades Specifications 2018 Version 25.0",
  },
} as const;

export const CREDITEX_VEU_PUBLIC_REGISTRY_URL =
  "https://veu.esc.vic.gov.au/vpr/s/public-registry" as const;

export const CREDITEX_VEU_ELECTRICITY_EMISSIONS_FACTOR = "0.393" as const;
export const CREDITEX_VEU_METROPOLITAN_FACTOR = "0.98" as const;
export const CREDITEX_VEU_REGIONAL_FACTOR = "1.04" as const;

export type CreditexVeuInputOption = {
  value: string;
  label: string;
};

export type CreditexVeuInputCondition = {
  key: string;
  oneOf?: readonly string[];
  notOneOf?: readonly string[];
};

export type CreditexVeuInputDefinition = {
  key: string;
  label: string;
  type: "decimal" | "select";
  unit: string;
  help: string;
  defaultValue: string;
  source: "operator" | "approved_product" | "postcode_lookup";
  required: boolean;
  min?: string;
  max?: string;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  step?: string;
  options?: readonly CreditexVeuInputOption[];
  showWhen?: CreditexVeuInputCondition;
  omitWhenHidden?: boolean;
};

export type CreditexVeuActivityDefinition = {
  activityCode: string;
  title: string;
  scenarios: readonly string[];
  formulaKey: string;
  sourcePages: string;
  productRegistry: "VEU" | "GEMS" | "VEU_AND_GEMS" | "none";
  productPerformanceInputs: readonly string[];
  inputDefinitions: readonly CreditexVeuInputDefinition[];
};

const METRO_REGIONAL_OPTIONS = [
  { value: "metropolitan", label: "Metropolitan Victoria" },
  { value: "regional", label: "Regional Victoria" },
] as const;

const LOCATION_CLASS_OPTIONS = [
  { value: "metro_mild", label: "Metropolitan, mild climate" },
  { value: "metro_cold", label: "Metropolitan, cold climate" },
  { value: "regional_mild", label: "Regional, mild climate" },
  { value: "regional_cold", label: "Regional, cold climate" },
  { value: "regional_hot", label: "Regional, hot climate" },
] as const;

const SYSTEM_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
] as const;

const CLIMATE_ZONE_OPTIONS = [
  { value: "4", label: "AS/NZS 4234 climate zone 4" },
  { value: "5", label: "AS/NZS 4234 climate zone 5" },
] as const;

export const CREDITEX_VEU_LOCATION_CLASSES = [
  "metro_mild",
  "metro_cold",
  "regional_mild",
  "regional_cold",
  "regional_hot",
] as const;

export type CreditexVeuLocationClass =
  typeof CREDITEX_VEU_LOCATION_CLASSES[number];

export const CREDITEX_VEU_PART_6_CATEGORIES = [
  "6A",
  "6B(i)",
  "6B(ii)",
  "6C",
  "6D",
  "6E(i)",
  "6E(ii)",
  "6F",
  "6G",
] as const;

export type CreditexVeuPart6Category =
  typeof CREDITEX_VEU_PART_6_CATEGORIES[number];

export const CREDITEX_VEU_PART_6_SCENARIOS = [
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
] as const;

export type CreditexVeuPart6Scenario =
  typeof CREDITEX_VEU_PART_6_SCENARIOS[number];

type Part6CategoryFactors = {
  hspfCold: string;
  hspfMixed: string;
  tcspfCold: string;
  tcspfMixed: string;
  lossFactor: string;
  minimumHspf: string;
  minimumTcspf: string;
};

export const CREDITEX_VEU_PART_6_CATEGORY_FACTORS = {
  residential: {
    "6A": {
      hspfCold: "3.03", hspfMixed: "3.42", tcspfCold: "3.66", tcspfMixed: "3.59",
      lossFactor: "1.18", minimumHspf: "3.6", minimumTcspf: "4.4",
    },
    "6B(i)": {
      hspfCold: "2.86", hspfMixed: "3.25", tcspfCold: "3.42", tcspfMixed: "3.35",
      lossFactor: "1.18", minimumHspf: "3.4", minimumTcspf: "4.2",
    },
    "6B(ii)": {
      hspfCold: "2.86", hspfMixed: "3.22", tcspfCold: "3.22", tcspfMixed: "3.05",
      lossFactor: "1.18", minimumHspf: "3.2", minimumTcspf: "3.6",
    },
    "6D": {
      hspfCold: "3.89", hspfMixed: "4.36", tcspfCold: "5.38", tcspfMixed: "5.23",
      lossFactor: "1", minimumHspf: "4.2", minimumTcspf: "5.4",
    },
    "6E(i)": {
      hspfCold: "3.62", hspfMixed: "4.17", tcspfCold: "4.91", tcspfMixed: "4.73",
      lossFactor: "1", minimumHspf: "3.7", minimumTcspf: "5",
    },
    "6E(ii)": {
      hspfCold: "3.5", hspfMixed: "4.17", tcspfCold: "4.8", tcspfMixed: "4.73",
      lossFactor: "1", minimumHspf: "3.6", minimumTcspf: "4.8",
    },
    "6F": {
      hspfCold: "3.43", hspfMixed: "3.98", tcspfCold: "4.44", tcspfMixed: "4.35",
      lossFactor: "1", minimumHspf: "3.6", minimumTcspf: "4.6",
    },
  },
  business: {
    "6A": {
      hspfCold: "3.24", hspfMixed: "3.61", tcspfCold: "4.49", tcspfMixed: "4.24",
      lossFactor: "1.18", minimumHspf: "3.6", minimumTcspf: "4.4",
    },
    "6B(i)": {
      hspfCold: "3.08", hspfMixed: "3.46", tcspfCold: "4.3", tcspfMixed: "4.04",
      lossFactor: "1.18", minimumHspf: "3.4", minimumTcspf: "4.2",
    },
    "6B(ii)": {
      hspfCold: "3.08", hspfMixed: "3.22", tcspfCold: "4.15", tcspfMixed: "3.73",
      lossFactor: "1.18", minimumHspf: "3.2", minimumTcspf: "3.6",
    },
    "6C": {
      hspfCold: "2.88", hspfMixed: "3.22", tcspfCold: "3.56", tcspfMixed: "3.39",
      lossFactor: "1.18", minimumHspf: "3.2", minimumTcspf: "4.8",
    },
    "6D": {
      hspfCold: "4.13", hspfMixed: "4.54", tcspfCold: "7.85", tcspfMixed: "6.79",
      lossFactor: "1", minimumHspf: "4.2", minimumTcspf: "5.4",
    },
    "6E(i)": {
      hspfCold: "3.93", hspfMixed: "4.44", tcspfCold: "6.62", tcspfMixed: "5.93",
      lossFactor: "1", minimumHspf: "3.7", minimumTcspf: "5",
    },
    "6E(ii)": {
      hspfCold: "3.8", hspfMixed: "4.44", tcspfCold: "6.5", tcspfMixed: "5.93",
      lossFactor: "1", minimumHspf: "3.6", minimumTcspf: "4.8",
    },
    "6F": {
      hspfCold: "3.77", hspfMixed: "4.31", tcspfCold: "5.98", tcspfMixed: "5.52",
      lossFactor: "1", minimumHspf: "3.6", minimumTcspf: "4.6",
    },
    "6G": {
      hspfCold: "2.8", hspfMixed: "3.3", tcspfCold: "5.3", tcspfMixed: "4.94",
      lossFactor: "1", minimumHspf: "2.7", minimumTcspf: "5.3",
    },
  },
} as const satisfies {
  residential: Partial<Record<CreditexVeuPart6Category, Part6CategoryFactors>>;
  business: Record<CreditexVeuPart6Category, Part6CategoryFactors>;
};

export const CREDITEX_VEU_PART_6_BUILDING_LOADS = {
  metro_mild: {
    residential: { heating: "1.3144", cooling: "0.2696" },
    business: { heating: "0.7866", cooling: "0.7175" },
  },
  metro_cold: {
    residential: { heating: "1.4458", cooling: "0.2696" },
    business: { heating: "0.8652", cooling: "0.7175" },
  },
  regional_mild: {
    residential: { heating: "1.3144", cooling: "0.2696" },
    business: { heating: "0.7866", cooling: "0.7175" },
  },
  regional_cold: {
    residential: { heating: "1.4458", cooling: "0.2696" },
    business: { heating: "0.8652", cooling: "0.7175" },
  },
  regional_hot: {
    residential: { heating: "0.7211", cooling: "0.4296" },
    business: { heating: "0.5915", cooling: "0.891" },
  },
} as const;

export const CREDITEX_VEU_PART_6_BASELINES = {
  i: { hspf: "1", tcspf: "category", heatingIntensity: "electric", coolingIntensity: "electric" },
  ii: { hspf: "1", tcspfCold: "3.29", tcspfMixed: "3.264", heatingIntensity: "electric", coolingIntensity: "electric" },
  iii: { hspf: "0.847", tcspf: "category", heatingIntensity: "electric", coolingIntensity: "electric" },
  iv: { hspf: "0.847", tcspfCold: "2.788", tcspfMixed: "2.766", heatingIntensity: "electric", coolingIntensity: "electric" },
  v: { hspfCold: "2.358", hspfMixed: "2.594", tcspfCold: "2.788", tcspfMixed: "2.766", heatingIntensity: "electric", coolingIntensity: "electric" },
  vi: { hspfCold: "2.892", hspfMixed: "3.268", tcspfCold: "4.053", tcspfMixed: "3.932", heatingIntensity: "electric", coolingIntensity: "electric" },
  vii: { hspf: "0.551", tcspf: "category", heatingIntensity: "gas", coolingIntensity: "electric" },
  viii: { hspf: "0.551", tcspfCold: "2.788", tcspfMixed: "2.766", heatingIntensity: "gas", coolingIntensity: "electric" },
  ix: { hspf: "0.76", tcspf: "category", heatingIntensity: "gas", coolingIntensity: "electric" },
  x: { hspf: "0.76", tcspfCold: "4.053", tcspfMixed: "3.932", heatingIntensity: "gas", coolingIntensity: "electric" },
  xi: { hspf: "category", tcspf: "category", heatingIntensity: "electric", coolingIntensity: "electric" },
} as const;

export const CREDITEX_VEU_ACTIVITY_DEFINITIONS = [
  {
    activityCode: "1C",
    title: "Electric-boosted solar water heater replacing electric resistance",
    scenarios: ["1C(i)"],
    formulaKey: "veu-part-1c-asnzs-4234-2021/v1",
    sourcePages: "Version 25 pages 16-20, Equation 1.1 and Table 1.4",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "system size", "climate zone 4"],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "system_size", label: "AS/NZS 4234 system size", type: "select", unit: "size", help: "Use the approved model's small or medium load classification.", defaultValue: "small", source: "approved_product", required: true, options: SYSTEM_SIZE_OPTIONS },
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Part 1C uses the approved-product climate-zone 4 performance values.", defaultValue: "4", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
    ],
  },
  {
    activityCode: "1D",
    title: "Heat-pump water heater replacing electric resistance",
    scenarios: ["1D(i)"],
    formulaKey: "veu-part-1d-asnzs-4234-2021/v1",
    sourcePages: "Version 25 pages 16-20, Equation 1.2 and Table 1.5",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "system size", "climate zone 4 or 5"],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "system_size", label: "AS/NZS 4234 system size", type: "select", unit: "size", help: "Use the approved model's small or medium load classification.", defaultValue: "small", source: "approved_product", required: true, options: SYSTEM_SIZE_OPTIONS },
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Resolve zone 4 or 5 and use the matching approved-product performance values.", defaultValue: "5", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
    ],
  },
  {
    activityCode: "3C",
    title: "Heat-pump water heater replacing gas or LPG",
    scenarios: ["3C"],
    formulaKey: "veu-part-3c-asnzs-4234-2021/v1",
    sourcePages: "Version 25 pages 21-24, Equation 3.1 and Table 3.4",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "climate zone 4 or 5"],
    inputDefinitions: [
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Resolve zone 4 or 5 and use the matching approved-product performance values.", defaultValue: "5", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
    ],
  },
  {
    activityCode: "3D",
    title: "Electric-boosted solar water heater replacing gas or LPG",
    scenarios: ["3D"],
    formulaKey: "veu-part-3d-asnzs-4234-2021/v1",
    sourcePages: "Version 25 pages 21-24, Equation 3.2 and Table 3.5",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "climate zone 4"],
    inputDefinitions: [
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Part 3D uses the approved-product climate-zone 4 performance values.", defaultValue: "4", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
    ],
  },
  {
    activityCode: "6",
    title: "High-efficiency air conditioner",
    scenarios: CREDITEX_VEU_PART_6_SCENARIOS,
    formulaKey: "veu-part-6-equations-6.1-to-6.5/v1",
    sourcePages: "Version 24 pages 25-36; Version 25 pages 25-37; 20 kW residential multi-split cap applies from 30 September 2026",
    productRegistry: "VEU",
    productPerformanceInputs: ["rated capacities", "HSPF", "TCSPF", "GWP", "configuration"],
    inputDefinitions: [
      { key: "scenario", label: "Installation scenario", type: "select", unit: "scenario", help: "Select the exact incumbent-equipment scenario in Part 6; the scenario controls the baseline and asset life.", defaultValue: "xi", source: "operator", required: true, options: CREDITEX_VEU_PART_6_SCENARIOS.map((value) => ({ value, label: `Scenario (${value})` })) },
      { key: "category", label: "Air-conditioner category", type: "select", unit: "category", help: "Populate the approved-product Part 6 category. Categories 6C and 6G are business-only.", defaultValue: "6D", source: "approved_product", required: true, options: CREDITEX_VEU_PART_6_CATEGORIES.map((value) => ({ value, label: `Category ${value}` })) },
      { key: "premises", label: "Premises type", type: "select", unit: "premises", help: "Choose the premises class used by the applicable Part 6 category and building thermal-load table.", defaultValue: "residential", source: "operator", required: true, options: [{ value: "residential", label: "Residential" }, { value: "business", label: "Business or non-residential" }] },
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the official metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "configuration", label: "System configuration", type: "select", unit: "configuration", help: "Populate the selected approved system's single-split or multi-split configuration.", defaultValue: "single", source: "approved_product", required: true, options: [{ value: "single", label: "Single system" }, { value: "multi", label: "Multi-split system" }] },
      { key: "rated_heating_capacity_kw", label: "Rated heating capacity", type: "decimal", unit: "kW", help: "For a single system use its approved rated heating capacity; for a multi-split use the sum of selected indoor-unit ratings.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "rated_cooling_capacity_kw", label: "Rated cooling capacity", type: "decimal", unit: "kW", help: "For a single system use its approved rated cooling capacity; for a multi-split use the sum of selected indoor-unit ratings.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "outdoor_heating_capacity_kw", label: "Outdoor-unit heating capacity", type: "decimal", unit: "kW", help: "For multi-split systems use the selected approved outdoor unit's exact rated heating capacity.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
      { key: "outdoor_cooling_capacity_kw", label: "Outdoor-unit cooling capacity", type: "decimal", unit: "kW", help: "For multi-split systems use the selected approved outdoor unit's exact rated cooling capacity.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
      { key: "hspf_upgrade", label: "Applicable HSPF", type: "decimal", unit: "W/W", help: "Use the selected product's applicable GEMS or calculated HSPF for the governed location and premises class.", defaultValue: "6", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "tcspf_upgrade", label: "Applicable TCSPF", type: "decimal", unit: "W/W", help: "Use the selected product's applicable GEMS or calculated TCSPF for the governed location and premises class.", defaultValue: "7", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "hspf_cold_eligibility", label: "Cold-zone eligibility HSPF", type: "decimal", unit: "W/W", help: "Use the approved product's cold-zone HSPF; the estimator checks it against the category minimum.", defaultValue: "4.2", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "tcspf_cold_eligibility", label: "Cold-zone eligibility TCSPF", type: "decimal", unit: "W/W", help: "Use the approved product's cold-zone TCSPF; the estimator checks it against the category minimum.", defaultValue: "5.4", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "refrigerant_gwp", label: "Refrigerant global warming potential", type: "decimal", unit: "GWP", help: "Populate the approved refrigerant GWP. Products below 15 kW rated cooling capacity must be below 700.", defaultValue: "675", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "performance_basis", label: "Seasonal-performance basis", type: "select", unit: "method", help: "Record whether the selected HSPF and TCSPF are published GEMS values or calculated from approved ACOP/AEER data.", defaultValue: "gems", source: "approved_product", required: true, options: [{ value: "gems", label: "GEMS HSPF and TCSPF" }, { value: "calculated_from_acop_aeer", label: "Calculated from ACOP and AEER" }] },
      { key: "same_oem_confirmed", label: "Same OEM confirmation", type: "select", unit: "confirmation", help: "Multi-split indoor and outdoor units must use the same original equipment manufacturer.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed" }], showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "13",
    title: "WERS-rated double glazing",
    scenarios: ["13A"],
    formulaKey: "veu-part-13-equation-13.1/v1",
    sourcePages: "Version 25 pages 38-39, Equation 13.1 and Table 13.2",
    productRegistry: "VEU",
    productPerformanceInputs: ["WERS heating stars"],
    inputDefinitions: [
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the official metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "area_m2", label: "Installed glazing area", type: "decimal", unit: "m2", help: "Enter the eligible installed glazing area. Part 13 requires at least 5 m2.", defaultValue: "5", source: "operator", required: true, min: "5", step: "any" },
      { key: "wers_heating_stars", label: "WERS heating stars", type: "decimal", unit: "stars", help: "Populate the selected approved product's WERS heating rating. Part 13 requires at least 4 stars.", defaultValue: "4", source: "approved_product", required: true, min: "4", step: "any" },
    ],
  },
  {
    activityCode: "14",
    title: "Secondary glazing, acrylic panel or insulating film",
    scenarios: ["14A", "14B"],
    formulaKey: "veu-part-14-equation-14.1/v1",
    sourcePages: "Version 25 pages 40-41, Equation 14.1 and Table 14.2",
    productRegistry: "VEU",
    productPerformanceInputs: ["product type"],
    inputDefinitions: [
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the official metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "area_m2", label: "Installed glazing area", type: "decimal", unit: "m2", help: "Enter the eligible installed glazing area. Part 14 requires at least 5 m2.", defaultValue: "5", source: "operator", required: true, min: "5", step: "any" },
      { key: "product_type", label: "Glazing product type", type: "select", unit: "type", help: "Use the selected approved product type; film has a 5-year life and glass/acrylic has a 15-year life.", defaultValue: "glass", source: "approved_product", required: true, options: [{ value: "glass", label: "Secondary glass" }, { value: "acrylic", label: "Acrylic panel" }, { value: "film", label: "Insulating film" }] },
    ],
  },
  {
    activityCode: "15",
    title: "Weather sealing",
    scenarios: ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "15H"],
    formulaKey: "veu-part-15-equations-15.1-to-15.8/v1",
    sourcePages: "Version 25 pages 42-52, Tables 15.2-15.9",
    productRegistry: "VEU",
    productPerformanceInputs: ["scenario", "warranty period where applicable", "area or installation count"],
    inputDefinitions: [
      { key: "scenario", label: "Weather-sealing scenario", type: "select", unit: "scenario", help: "Select the exact approved Part 15 product/activity scenario.", defaultValue: "15A", source: "approved_product", required: true, options: ["15A", "15B", "15C", "15D", "15E", "15F", "15G", "15H"].map((value) => ({ value, label: `Scenario ${value}` })) },
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the official metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "installation_count", label: "Installation count", type: "decimal", unit: "installations", help: "Enter the eligible installation count. Scenario 15B instead uses window area.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1", showWhen: { key: "scenario", notOneOf: ["15B"] }, omitWhenHidden: true },
      { key: "area_m2", label: "Window area", type: "decimal", unit: "m2", help: "Enter the eligible window area for scenario 15B.", defaultValue: "1", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["15B"] }, omitWhenHidden: true },
      { key: "warranty_years", label: "Product warranty", type: "decimal", unit: "years", help: "For scenarios other than 15F and 15G, enter the approved warranty. Two to under five years gives a 5-year life; five years or more gives 10 years.", defaultValue: "5", source: "approved_product", required: true, min: "2", step: "any", showWhen: { key: "scenario", notOneOf: ["15F", "15G"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "17",
    title: "Low-flow shower rose",
    scenarios: ["17A"],
    formulaKey: "veu-part-17-equation-17.1/v1",
    sourcePages: "Version 25 pages 53-54, Equation 17.1 and Table 17.2",
    productRegistry: "VEU",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "installation_count", label: "Shower-rose count", type: "decimal", unit: "installations", help: "Enter the number of eligible low-flow shower roses installed.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
    ],
  },
  {
    activityCode: "22",
    title: "High-efficiency refrigerator or freezer",
    scenarios: ["22A", "22B", "22C", "22D"],
    formulaKey: "veu-part-22-fixed-reduction/v1",
    sourcePages: "Version 25 pages 55-57, Tables 22.3-22.6",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "VEU approval start/end",
      "VEU-approved 22A to 22D category",
      "total storage volume",
      "star rating",
      "comparative energy consumption",
      "GEMS determination version",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Appliance scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry listing determines the prescribed 22A to 22D scenario.", defaultValue: "22A", source: "approved_product", required: true, options: ["22A", "22B", "22C", "22D"].map((value) => ({ value, label: `Scenario ${value}` })) },
    ],
  },
  {
    activityCode: "24",
    title: "High-efficiency television",
    scenarios: ["24A"],
    formulaKey: "veu-part-24-fixed-reduction/v1",
    sourcePages: "Version 25 pages 58-59, Table 24.3",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "VEU approval start/end",
      "VEU-approved category",
      "star rating",
      "screen area",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Television scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry television listing determines prescribed scenario 24A.", defaultValue: "24A", source: "approved_product", required: true, options: [{ value: "24A", label: "Scenario 24A" }] },
    ],
  },
  {
    activityCode: "25",
    title: "Energy-efficient clothes dryer",
    scenarios: ["25A"],
    formulaKey: "veu-part-25-fixed-reduction/v1",
    sourcePages: "Version 25 pages 60-61, Table 25.3",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "VEU approval start/end",
      "VEU-approved category",
      "star rating",
      "drying capacity",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Clothes-dryer scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry clothes-dryer listing determines prescribed scenario 25A.", defaultValue: "25A", source: "approved_product", required: true, options: [{ value: "25A", label: "Scenario 25A" }] },
    ],
  },
  {
    activityCode: "26",
    title: "High-efficiency pool pump",
    scenarios: ["26A"],
    formulaKey: "veu-part-26-equation-26.1/v1",
    sourcePages: "Version 25 pages 62-63, Equation 26.1 and Table 26.2",
    productRegistry: "VEU",
    productPerformanceInputs: ["PAEC"],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "paec_kwh_per_year", label: "PAEC", type: "decimal", unit: "kWh/year", help: "Populate the selected approved pool pump's exact projected annual energy consumption. A positive reduction requires PAEC below 1,160 kWh/year.", defaultValue: "500", source: "approved_product", required: true, min: "0", max: "1160", maxExclusive: true, step: "any" },
    ],
  },
  {
    activityCode: "46",
    title: "Induction cooking product",
    scenarios: ["46A", "46B"],
    formulaKey: "veu-part-46-equation-46.1/v1",
    sourcePages: "Version 25 pages 134-135, Equation 46.1 and Table 46.3",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "VEU approval category",
      "VEU approval start/end",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Induction-cooking scenario", type: "select", unit: "scenario", help: "The selected VEU-approved product determines the prescribed 46A or 46B scenario.", defaultValue: "46A", source: "approved_product", required: true, options: [{ value: "46A", label: "Scenario 46A" }, { value: "46B", label: "Scenario 46B" }] },
    ],
  },
  {
    activityCode: "48",
    title: "Ceiling insulation",
    scenarios: ["48A(i)", "48A(ii)", "48B(i)", "48B(ii)"],
    formulaKey: "veu-part-48-equation-48.1/v1",
    sourcePages: "Version 25 pages 140-144, Equation 48.1 and Table 48.3",
    productRegistry: "VEU",
    productPerformanceInputs: ["installed area", "climatic region"],
    inputDefinitions: [
      { key: "scenario", label: "Ceiling-insulation scenario", type: "select", unit: "scenario", help: "Select the exact Part 48 installation and incumbent-insulation scenario.", defaultValue: "48A(i)", source: "operator", required: true, options: ["48A(i)", "48A(ii)", "48B(i)", "48B(ii)"].map((value) => ({ value, label: `Scenario ${value}` })) },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "climatic_region", label: "Climatic region", type: "select", unit: "region", help: "Resolve the official mild, cold or hot climatic region from the installation postcode.", defaultValue: "mild", source: "postcode_lookup", required: true, options: [{ value: "mild", label: "Mild" }, { value: "cold", label: "Cold" }, { value: "hot", label: "Hot" }] },
      { key: "area_m2", label: "Installed insulation area", type: "decimal", unit: "m2", help: "Enter the eligible ceiling area covered by the selected approved insulation product.", defaultValue: "100", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
    ],
  },
] as const satisfies readonly CreditexVeuActivityDefinition[];

export const CREDITEX_VEU_DEFERRED_ACTIVITIES = [
  { activityCode: "27", reason: "Public lighting requires a source-by-source AEMO/ESC LCP, control-multiplier, asset-life and annual-operating-hours contract before deterministic aggregation." },
  { activityCode: "28", reason: "The formula is transcribed, but heater-capacity class, incumbent ductwork and AS/NZS 4859.1 product evidence still require a validated activity contract." },
  { activityCode: "30", reason: "The formula is transcribed, but the estimator must first ingest and date-lock the current ESC in-home-display product register." },
  { activityCode: "31", reason: "Both motor formulas require the complete rated-output savings/lifetime tables plus GEMS evidence for 31A and ESC product evidence for 31B." },
  { activityCode: "32", reason: "Current scenarios 32A(i) to 32A(iii) require GEMS product class, EEI, TEC, TDA or volume, M/N coefficients and duty adjustment tables in a separate validated input contract; historical 32A closed in 2022." },
  { activityCode: "33", reason: "Fan-motor activities require NFIP, refrigerator-type COP and incumbent/upgrade fan evidence in a separate equipment contract." },
  { activityCode: "34", reason: "Building lighting requires source-by-source LCP, control and air-conditioning multipliers, Part J6 treatment, asset life and operating-hours aggregation." },
  { activityCode: "35", reason: "Non-building lighting requires source-by-source LCP, control multiplier, asset life and operating-hours aggregation." },
  { activityCode: "36", reason: "The fixed formula is transcribed, but selected-product WELS six-star eligibility and current ESC product evidence require a dedicated contract." },
  { activityCode: "37-42", reason: "Industrial gas activities require governed consumption caps, DEI branch evidence, LUF, equipment age/type/efficiency and commissioning evidence in a separate contract." },
  { activityCode: "43", reason: "Cold-room formulas are transcribed, but each system requires operating temperature, internal floor-area size band and installed-component evidence." },
  { activityCode: "44", reason: "The public registry detail view does not expose the RefElec input required by Equations 44.1-44.3." },
  { activityCode: "45", reason: "Closed on 23 June 2026; no current VEU claim is available." },
  { activityCode: "47", reason: "CEC module, inverter, DNSP and system-level evidence require a separate solar-system contract." },
  { activityCode: "PBA", reason: "Project-based activities use approved M&V or benchmark-rating projects, not a deemed dropdown formula." },
] as const;
