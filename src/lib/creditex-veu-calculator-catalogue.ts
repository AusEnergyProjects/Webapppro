export const CREDITEX_VEU_CATALOGUE_REVIEWED_ON = "2026-08-09" as const;

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

export const CREDITEX_VEU_PART_44_APPLICATION_GUIDE = {
  version: "2.2",
  publishedOn: "2026-03-31",
  url: "https://www.esc.vic.gov.au/sites/default/files/documents/FINAL%20-%20Commercial%20and%20Industrial%20Air%20Source%20Heat%20Pump%20Water%20Heater%20Product%20Application%20Guide%20-%20V%202.2%2020260331.pdf",
  title: "Commercial and Industrial Air Source Heat Pump Water Heater Product Application Guide",
  pages: "Appendix A, document pages 19-20",
} as const;

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
  quoteSource?: "operator";
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

export type CreditexVeuQuoteEvidenceAssumption = {
  key: string;
  assumedValue: string;
};

/**
 * Explicitly identifies non-arithmetic activity evidence that quote mode may
 * leave unconfirmed. The estimator substitutes only these values, records the
 * substitution in its sealed receipt and never uses this contract for strict
 * compliance estimates.
 */
export const CREDITEX_VEU_QUOTE_EVIDENCE_ASSUMPTIONS = {
  "1C": [
    { key: "incumbent_scenario_requirements_confirmed", assumedValue: "yes" },
    { key: "residential_consumer_fact_sheet_provided", assumedValue: "yes" },
    { key: "residential_suitability_and_sizing_advice_confirmed", assumedValue: "yes" },
    { key: "no_additional_inline_storage_or_system_confirmed", assumedValue: "yes" },
    { key: "decommissioning_and_disposal_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
  "1D": [
    { key: "incumbent_scenario_requirements_confirmed", assumedValue: "yes" },
    { key: "residential_consumer_fact_sheet_provided", assumedValue: "yes" },
    { key: "residential_suitability_and_sizing_advice_confirmed", assumedValue: "yes" },
    { key: "no_additional_inline_storage_or_system_confirmed", assumedValue: "yes" },
    { key: "decommissioning_and_disposal_confirmed", assumedValue: "yes" },
    { key: "warranty_years", assumedValue: "5" },
    { key: "warranty_requirements_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
  "3C": [
    { key: "incumbent_scenario_requirements_confirmed", assumedValue: "yes" },
    { key: "residential_consumer_fact_sheet_provided", assumedValue: "yes" },
    { key: "residential_suitability_and_sizing_advice_confirmed", assumedValue: "yes" },
    { key: "no_additional_inline_storage_or_system_confirmed", assumedValue: "yes" },
    { key: "decommissioning_and_disposal_confirmed", assumedValue: "yes" },
    { key: "warranty_years", assumedValue: "5" },
    { key: "warranty_requirements_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
  "3D": [
    { key: "incumbent_scenario_requirements_confirmed", assumedValue: "yes" },
    { key: "residential_consumer_fact_sheet_provided", assumedValue: "yes" },
    { key: "residential_suitability_and_sizing_advice_confirmed", assumedValue: "yes" },
    { key: "no_additional_inline_storage_or_system_confirmed", assumedValue: "yes" },
    { key: "decommissioning_and_disposal_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
  "6": [
    { key: "same_oem_confirmed", assumedValue: "yes" },
    { key: "incumbent_scenario_requirements_confirmed", assumedValue: "yes" },
    { key: "decommissioning_and_disposal_confirmed", assumedValue: "yes" },
    { key: "residential_consumer_fact_sheet_provided", assumedValue: "yes" },
    { key: "residential_suitability_and_sizing_advice_confirmed", assumedValue: "yes" },
    { key: "warranty_years", assumedValue: "5" },
    { key: "warranty_requirements_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
  "27": [{ key: "removal_requirements_confirmed", assumedValue: "yes" }],
  "31": [{ key: "co_payment_per_motor_aud", assumedValue: "200" }],
  "34": [
    { key: "vru_compatibility_confirmed", assumedValue: "yes" },
    { key: "removal_requirements_confirmed", assumedValue: "yes" },
  ],
  "35": [{ key: "removal_requirements_confirmed", assumedValue: "yes" }],
  "39": [{ key: "eligibility_requirements_confirmed", assumedValue: "yes" }],
  "40": [{ key: "eligibility_requirements_confirmed", assumedValue: "yes" }],
  "42": [{ key: "eligibility_requirements_confirmed", assumedValue: "yes" }],
  "43": [
    { key: "eligible_parts_configuration_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_cold_room_aud", assumedValue: "500" },
  ],
  "44": [
    { key: "warranty_years", assumedValue: "5" },
    { key: "incumbent_decommissioning_evidence_confirmed", assumedValue: "yes" },
    { key: "existing_storage_requirements_confirmed", assumedValue: "yes" },
    { key: "installation_and_model_evidence_confirmed", assumedValue: "yes" },
    { key: "co_payment_per_installed_product_aud", assumedValue: "10000" },
  ],
} as const satisfies Partial<Record<
  string,
  readonly CreditexVeuQuoteEvidenceAssumption[]
>>;

export type CreditexVeuActivityDefinition = {
  activityCode: string;
  title: string;
  scenarios: readonly string[];
  formulaKey: string;
  sourcePages: string;
  productRegistry: "VEU" | "GEMS" | "VEU_AND_GEMS" | "none";
  productPerformanceInputs: readonly string[];
  inputDefinitions: readonly CreditexVeuInputDefinition[];
  internalExecutableScenarios?: readonly string[];
  supportingSources?: readonly {
    version: string;
    publishedOn: string;
    url: string;
    title: string;
    pages: string;
  }[];
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

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const SIMPLE_LIGHTING_CONTROL_OPTIONS = [
  { value: "none", label: "No lighting control device, CM 1.00" },
  { value: "occupancy_1_to_2", label: "Occupancy sensor controlling 1 to 2 luminaires, CM 0.55" },
  { value: "occupancy_3_to_6", label: "Occupancy sensor controlling 3 to 6 luminaires, CM 0.70" },
  { value: "occupancy_more_than_6", label: "Occupancy sensor controlling more than 6 luminaires, CM 0.90" },
  { value: "programmable_dimmer", label: "Programmable dimmer, CM 0.85" },
  { value: "occupancy_1_to_2_and_programmable_dimmer", label: "Occupancy sensor for 1 to 2 luminaires plus programmable dimmer, CM 0.4675" },
  { value: "occupancy_3_to_6_and_programmable_dimmer", label: "Occupancy sensor for 3 to 6 luminaires plus programmable dimmer, CM 0.595" },
  { value: "occupancy_more_than_6_and_programmable_dimmer", label: "Occupancy sensor for more than 6 luminaires plus programmable dimmer, CM 0.765" },
] as const;

const PART_34_OCCUPANCY_OPTIONS = [
  { value: "none", label: "No occupancy sensor" },
  { value: "one_to_two_luminaires", label: "Occupancy sensor controls 1 to 2 luminaires" },
  { value: "three_to_six_luminaires", label: "Occupancy sensor controls 3 to 6 luminaires" },
  { value: "more_than_six_luminaires", label: "Occupancy sensor controls more than 6 luminaires" },
] as const;

const PART_34_ANNUAL_HOURS_OPTIONS = [
  { value: "1000", label: "1,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "2000", label: "2,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "3000", label: "3,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "4500", label: "4,500 hours, open-air Class 7a branch" },
  { value: "5000", label: "5,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "5100", label: "5,100 hours, eligible health and fitness centre branch" },
  { value: "6000", label: "6,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "7000", label: "7,000 hours, applicable Table 34.6 or 34.10 branch" },
  { value: "8500", label: "8,500 hours, maintained emergency lighting" },
] as const;

function part34ControlInputDefinitions(
  prefix: "baseline" | "approved_upgrade" | "retained_upgrade",
  label: string,
  source: CreditexVeuInputDefinition["source"],
  scenarios?: readonly string[],
): CreditexVeuInputDefinition[] {
  const condition = scenarios
    ? { key: "scenario", oneOf: scenarios }
    : undefined;
  const visibility = condition
    ? { showWhen: condition, omitWhenHidden: true }
    : {};
  return [
    { key: `${prefix}_occupancy_sensor_scope`, label: `${label} occupancy-sensor scope`, type: "select", unit: "control", help: prefix === "approved_upgrade" ? "Enter the evidenced number of luminaires controlled by each installed approved occupancy sensor. The product registry determines whether the selected product includes the sensor." : "Use the exact Table 34.7 occupancy-sensor branch.", defaultValue: prefix === "approved_upgrade" ? "one_to_two_luminaires" : "none", source: prefix === "approved_upgrade" ? "operator" : source, required: true, options: PART_34_OCCUPANCY_OPTIONS, ...visibility },
    { key: `${prefix}_daylight_linked_control`, label: `${label} daylight-linked control`, type: "select", unit: "control", help: "The estimator applies the exact Table 34.7 factor of 0.70 when present.", defaultValue: "no", source, required: true, options: YES_NO_OPTIONS, ...visibility },
    { key: `${prefix}_programmable_dimmer`, label: `${label} programmable dimmer`, type: "select", unit: "control", help: "The estimator applies the exact Table 34.7 factor of 0.85 when present.", defaultValue: "no", source, required: true, options: YES_NO_OPTIONS, ...visibility },
    { key: `${prefix}_manual_dimmer`, label: `${label} manual dimmer`, type: "select", unit: "control", help: "The estimator applies the exact Table 34.7 factor of 0.90 when present.", defaultValue: "no", source, required: true, options: YES_NO_OPTIONS, ...visibility },
    { key: `${prefix}_voltage_reduction_unit`, label: `${label} voltage reduction unit`, type: "select", unit: "control", help: "When present, Table 34.7 uses output voltage squared divided by 240 squared.", defaultValue: "no", source, required: true, options: YES_NO_OPTIONS, ...visibility },
    { key: `${prefix}_voltage_reduction_unit_output_v`, label: `${label} voltage-reduction-unit output`, type: "decimal", unit: "V", help: "Use the approved-laboratory output voltage. The estimator applies V squared divided by 240 squared and rejects values above 240 V.", defaultValue: "220", source, required: false, min: "0", minExclusive: true, max: "240", step: "any", showWhen: { key: `${prefix}_voltage_reduction_unit`, oneOf: ["yes"] }, omitWhenHidden: true },
  ];
}

function waterHeaterEligibilityInputDefinitions(
  incumbentDescription: string,
  heatPump: boolean,
): CreditexVeuInputDefinition[] {
  return [
    { key: "unit_quantity", label: "Number of identical systems", type: "decimal", unit: "systems", help: "For a quote, enter how many identical approved systems are being installed at this property. Each system is calculated separately, then the per-system estimate is multiplied. Maximum 10 systems per quote.", defaultValue: "1", source: "operator", required: true, min: "1", max: "10", step: "1" },
    { key: "premises", label: "Premises type", type: "select", unit: "premises", help: "Select whether the installation is at residential premises. The VEU consumer-information, suitability and sizing duties apply to residential work.", defaultValue: "residential", source: "operator", required: true, options: [{ value: "residential", label: "Residential" }, { value: "business", label: "Business or non-residential" }] },
    { key: "incumbent_scenario_requirements_confirmed", label: "Incumbent water-heater evidence", type: "select", unit: "confirmation", help: `Confirm the incumbent being decommissioned is ${incumbentDescription}. If it is a solar water heater with a non-functional solar component, retain evidence that the solar component was assessed and determined to be non-functional.`, defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS },
    { key: "residential_consumer_fact_sheet_provided", label: "VEU consumer fact sheet provided", type: "select", unit: "confirmation", help: "For residential work, confirm the current VEU Water Heating Consumer Fact Sheet was provided before the consumer agreed to the activity.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
    { key: "residential_suitability_and_sizing_advice_confirmed", label: "Suitability and sizing advice", type: "select", unit: "confirmation", help: "For residential work, confirm the consumer received clear, accurate suitability information and advice on whether the installed size is consistent with the current VEU Water Heating Consumer Fact Sheet.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
    { key: "no_additional_inline_storage_or_system_confirmed", label: "No manifold or in-line system", type: "select", unit: "confirmation", help: "Confirm the installed product is not connected in-line with an additional hot-water storage tank or hot-water system, including a manifold system.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS },
    { key: "decommissioning_and_disposal_confirmed", label: "Decommissioning and lawful disposal", type: "select", unit: "confirmation", help: "Confirm the incumbent was made incapable of reuse and the decommissioned product, waste and debris were removed where practical and safe and lawfully disposed of.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS },
    { key: "co_payment_per_installed_product_aud", label: "Co-payment per installed product", type: "decimal", unit: "AUD including GST", help: "Enter the evidenced energy-consumer co-payment per installed product. Parts 1 and 3 require at least $200 including GST for every supported installation date.", defaultValue: "0", source: "operator", required: true, min: "0", step: "any" },
    ...(heatPump
      ? [
          { key: "refrigerant_gwp", label: "Refrigerant global warming potential", type: "decimal", unit: "GWP", help: "Populate the selected approved heat-pump product's exact refrigerant GWP. The VEU requirement is strictly below 700.", defaultValue: "675", source: "approved_product", required: true, min: "0", step: "any" },
          { key: "warranty_years", label: "Product warranty", type: "decimal", unit: "years", help: "Enter the evidenced warranty-against-defects period. Supported heat-pump installations require at least five years.", defaultValue: "0", source: "operator", required: true, min: "0", step: "any" },
          { key: "warranty_requirements_confirmed", label: "Warranty obligations evidence", type: "select", unit: "confirmation", help: "Confirm the warranty evidence meets the VEU requirements, including an Australian warranty contact when the person giving the warranty is not in Australia.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS },
        ] satisfies CreditexVeuInputDefinition[]
      : []),
  ];
}

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

export const CREDITEX_VEU_PART_6_SCENARIO_OPTIONS = [
  { value: "i", label: "Replace the main hard-wired electric room heater, with no existing air conditioner (i)" },
  { value: "ii", label: "Replace the main hard-wired electric room heater and also decommission an air conditioner that heats the same area and is outside a residential bedroom or a business room under 20 m² (ii)" },
  { value: "iii", label: "Replace central electric resistance heating serving at least 100 m², or main slab heating, with no existing air conditioner (iii)" },
  { value: "iv", label: "Replace central electric resistance heating serving at least 100 m², or main slab heating, and also decommission an air conditioner that heats the same area and is outside a residential bedroom or a business room under 20 m² (iv)" },
  { value: "v", label: "Replace the ducted reverse-cycle air conditioner used as the main heating system (v)" },
  { value: "vi", label: "Replace a non-ducted reverse-cycle air conditioner (vi)" },
  { value: "vii", label: "Replace the main ducted gas heater, with no existing air conditioner (vii)" },
  { value: "viii", label: "Replace the main ducted gas heater and also decommission an air conditioner that heats the same area and is outside a residential bedroom or a business room under 20 m² (viii)" },
  { value: "ix", label: "Replace a non-ducted gas heater, with no existing air conditioner (ix)" },
  { value: "x", label: "Replace a non-ducted gas heater and also decommission an air conditioner that heats the same area and is outside a residential bedroom or a business room under 20 m² (x)" },
  { value: "xi", label: "Install a new high-efficiency air conditioner without decommissioning existing equipment (xi)" },
] as const satisfies readonly {
  value: CreditexVeuPart6Scenario;
  label: string;
}[];

const WEATHER_SEALING_SCENARIO_OPTIONS = [
  { value: "15A", label: "Seal the perimeter of an external door (15A)" },
  { value: "15B", label: "Seal an external window (15B)" },
  { value: "15C", label: "Replace an exhaust fan with a self-closing sealed fan (15C)" },
  { value: "15D", label: "Fit a self-closing damper or seal to an existing exhaust fan (15D)" },
  { value: "15E", label: "Seal an external wall vent (15E)" },
  { value: "15F", label: "Fit a permanent chimney or flue seal (15F)" },
  { value: "15G", label: "Fit a temporary or seasonal chimney or flue seal (15G)" },
  { value: "15H", label: "Fit a seasonal cover to an evaporative-cooling ceiling outlet (15H)" },
] as const;

const REFRIGERATOR_SCENARIO_OPTIONS = [
  { value: "22A", label: "Single-door refrigerator (22A)" },
  { value: "22B", label: "Two-door refrigerator (22B)" },
  { value: "22C", label: "Chest freezer (22C)" },
  { value: "22D", label: "Upright freezer (22D)" },
] as const;

const CEILING_INSULATION_SCENARIO_OPTIONS = [
  { value: "48A(i)", label: "Install category 48A bulk insulation in an uninsulated ceiling (48A(i))" },
  { value: "48A(ii)", label: "Top up an under-insulated ceiling with category 48A bulk insulation (48A(ii))" },
  { value: "48B(i)", label: "Install category 48B bulk insulation in an uninsulated ceiling (48B(i))" },
  { value: "48B(ii)", label: "Top up an under-insulated ceiling with category 48B bulk insulation (48B(ii))" },
] as const;

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
    formulaKey: "veu-part-1c-asnzs-4234-2021/v2",
    sourcePages: "Version 25 pages 16-20, Equation 1.1 and Table 1.4",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "system size", "climate zone 4", "installation-date product approval"],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "system_size", label: "AS/NZS 4234 system size", type: "select", unit: "size", help: "Use the approved model's small or medium load classification.", defaultValue: "small", source: "approved_product", required: true, options: SYSTEM_SIZE_OPTIONS },
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Part 1C uses the approved-product climate-zone 4 performance values.", defaultValue: "4", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      ...waterHeaterEligibilityInputDefinitions("the prescribed electric-resistance water heater", false),
    ],
  },
  {
    activityCode: "1D",
    title: "Heat-pump water heater replacing electric resistance",
    scenarios: ["1D(i)"],
    formulaKey: "veu-part-1d-asnzs-4234-2021/v2",
    sourcePages: "Version 25 pages 16-20, Equation 1.2 and Table 1.5",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "system size", "climate zone 4 or 5", "refrigerant GWP", "installation-date product approval"],
    inputDefinitions: [
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "system_size", label: "AS/NZS 4234 system size", type: "select", unit: "size", help: "Use the approved model's small or medium load classification.", defaultValue: "small", source: "approved_product", required: true, options: SYSTEM_SIZE_OPTIONS },
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Resolve zone 4 or 5 and use the matching approved-product performance values.", defaultValue: "5", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      ...waterHeaterEligibilityInputDefinitions("the prescribed electric-resistance water heater", true),
    ],
  },
  {
    activityCode: "3C",
    title: "Heat-pump water heater replacing gas or LPG",
    scenarios: ["3C"],
    formulaKey: "veu-part-3c-asnzs-4234-2021/v2",
    sourcePages: "Version 25 pages 21-24, Equation 3.1 and Table 3.4",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "climate zone 4 or 5", "refrigerant GWP", "installation-date product approval"],
    inputDefinitions: [
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Resolve zone 4 or 5 and use the matching approved-product performance values.", defaultValue: "5", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      ...waterHeaterEligibilityInputDefinitions("the prescribed gas or LPG water heater", true),
    ],
  },
  {
    activityCode: "3D",
    title: "Electric-boosted solar water heater replacing gas or LPG",
    scenarios: ["3D"],
    formulaKey: "veu-part-3d-asnzs-4234-2021/v2",
    sourcePages: "Version 25 pages 21-24, Equation 3.2 and Table 3.5",
    productRegistry: "VEU",
    productPerformanceInputs: ["Bs2021", "Be2021", "climate zone 4", "installation-date product approval"],
    inputDefinitions: [
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Part 3D uses the approved-product climate-zone 4 performance values.", defaultValue: "4", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "bs2021_gj_per_year", label: "Bs2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Bs2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "be2021_gj_per_year", label: "Be2021", type: "decimal", unit: "GJ/year", help: "Populate the exact Be2021 value for the selected approved model and governed climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      ...waterHeaterEligibilityInputDefinitions("the prescribed gas or LPG water heater", false),
    ],
  },
  {
    activityCode: "6",
    title: "High-efficiency air conditioner",
    scenarios: CREDITEX_VEU_PART_6_SCENARIOS,
    formulaKey: "veu-part-6-equations-6.1-to-6.5/v2",
    sourcePages: "Version 24 pages 25-36; Version 25 pages 25-37; 20 kW residential multi-split cap applies from 30 September 2026",
    productRegistry: "VEU",
    productPerformanceInputs: ["rated capacities", "HSPF", "TCSPF", "GWP", "configuration"],
    inputDefinitions: [
      { key: "scenario", label: "Installation scenario", type: "select", unit: "scenario", help: "Choose the plain-English description that exactly matches the equipment at the premises before installation.", defaultValue: "xi", source: "operator", required: true, options: CREDITEX_VEU_PART_6_SCENARIO_OPTIONS },
      { key: "category", label: "Air-conditioner category", type: "select", unit: "category", help: "Populate the approved-product Part 6 category. Categories 6C and 6G are business-only.", defaultValue: "6D", source: "approved_product", required: true, options: CREDITEX_VEU_PART_6_CATEGORIES.map((value) => ({ value, label: `Category ${value}` })) },
      { key: "premises", label: "Premises type", type: "select", unit: "premises", help: "Choose the premises class used by the applicable Part 6 category and building thermal-load table.", defaultValue: "residential", source: "operator", required: true, options: [{ value: "residential", label: "Residential" }, { value: "business", label: "Business or non-residential" }] },
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the official metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "configuration", label: "System configuration", type: "select", unit: "configuration", help: "Populate the selected approved system's exact single-split, multi-split or packaged configuration.", defaultValue: "single", source: "approved_product", required: true, options: [{ value: "single", label: "Single system" }, { value: "multi", label: "Multi-split or VRF system" }, { value: "packaged", label: "Packaged system" }] },
      { key: "rated_heating_capacity_kw", label: "Total installed indoor heating capacity", type: "decimal", unit: "kW", help: "For a single system this is replaced by the approved product rating. For a multi-split or VRF system, enter the total rated heating capacity of all connected indoor units.", defaultValue: "3.5", source: "approved_product", quoteSource: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "rated_cooling_capacity_kw", label: "Total installed indoor cooling capacity", type: "decimal", unit: "kW", help: "For a single system this is replaced by the approved product rating. For a multi-split or VRF system, enter the total rated cooling capacity of all connected indoor units.", defaultValue: "3.5", source: "approved_product", quoteSource: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "outdoor_heating_capacity_kw", label: "Outdoor-unit heating capacity", type: "decimal", unit: "kW", help: "For multi-split systems use the selected approved outdoor unit's exact rated heating capacity.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
      { key: "outdoor_cooling_capacity_kw", label: "Outdoor-unit cooling capacity", type: "decimal", unit: "kW", help: "For multi-split systems use the selected approved outdoor unit's exact rated cooling capacity.", defaultValue: "3.5", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
      { key: "hspf_upgrade", label: "Applicable HSPF", type: "decimal", unit: "W/W", help: "Use the selected product's applicable GEMS or calculated HSPF for the governed location and premises class.", defaultValue: "6", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "tcspf_upgrade", label: "Applicable TCSPF", type: "decimal", unit: "W/W", help: "Use the selected product's applicable GEMS or calculated TCSPF for the governed location and premises class.", defaultValue: "7", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "hspf_cold_eligibility", label: "Cold-zone eligibility HSPF", type: "decimal", unit: "W/W", help: "Use the approved product's cold-zone HSPF; the estimator checks it against the category minimum.", defaultValue: "4.2", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "tcspf_cold_eligibility", label: "Cold-zone eligibility TCSPF", type: "decimal", unit: "W/W", help: "Use the approved product's cold-zone TCSPF; the estimator checks it against the category minimum.", defaultValue: "5.4", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "refrigerant_gwp", label: "Refrigerant global warming potential", type: "decimal", unit: "GWP", help: "Populate the approved refrigerant GWP. Products below 15 kW rated cooling capacity must be below 700.", defaultValue: "675", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "performance_basis", label: "Seasonal-performance basis", type: "select", unit: "method", help: "Record whether the selected HSPF and TCSPF are both published GEMS values, both calculated from approved ACOP/AEER data, or independently resolved using one of each.", defaultValue: "gems", source: "approved_product", required: true, options: [{ value: "gems", label: "GEMS HSPF and TCSPF" }, { value: "calculated_from_acop_aeer", label: "Calculated HSPF and TCSPF from ACOP and AEER" }, { value: "mixed_gems_and_calculated", label: "Mixed GEMS and calculated seasonal values" }] },
      { key: "same_oem_confirmed", label: "Same OEM confirmation", type: "select", unit: "confirmation", help: "For a multi-split, confirm every installed indoor unit uses the same original equipment manufacturer as the connected outdoor unit.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "configuration", oneOf: ["multi"] }, omitWhenHidden: true },
      { key: "incumbent_scenario_requirements_confirmed", label: "Incumbent scenario evidence", type: "select", unit: "confirmation", help: "For scenarios (i) to (x), confirm the incumbent equipment, main-heating status, floor-area condition and absence or permitted location of any refrigerative air conditioner exactly match the selected Table 6.1 scenario.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "scenario", notOneOf: ["xi"] }, omitWhenHidden: true },
      { key: "decommissioning_and_disposal_confirmed", label: "Decommissioning and lawful disposal", type: "select", unit: "confirmation", help: "For scenarios (i) to (x), confirm each incumbent product was made incapable of reuse, refrigerant was lawfully disposed of where present, and removed waste and debris were lawfully disposed of.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "scenario", notOneOf: ["xi"] }, omitWhenHidden: true },
      { key: "residential_consumer_fact_sheet_provided", label: "VEU consumer fact sheet provided", type: "select", unit: "confirmation", help: "For residential work, confirm the current VEU Space Heating and Cooling Consumer Fact Sheet was provided before the consumer agreed to the activity.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
      { key: "residential_suitability_and_sizing_advice_confirmed", label: "Suitability and sizing advice", type: "select", unit: "confirmation", help: "For residential work, confirm the consumer received clear, accurate fit-for-purpose information and advice on whether the installed size is consistent with the current VEU consumer fact sheet.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
      { key: "warranty_years", label: "Product warranty", type: "decimal", unit: "years", help: "For residential work, enter the evidenced warranty-against-defects period. Part 6 requires at least five years.", defaultValue: "0", source: "operator", required: true, min: "0", step: "any", showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
      { key: "warranty_requirements_confirmed", label: "Warranty obligations evidence", type: "select", unit: "confirmation", help: "For residential work, confirm the warranty evidence meets the VEU requirements, including an Australian warranty contact when the person giving the warranty is not in Australia.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS, showWhen: { key: "premises", oneOf: ["residential"] }, omitWhenHidden: true },
      { key: "co_payment_per_installed_product_aud", label: "Co-payment per installed product", type: "decimal", unit: "AUD including GST", help: "Enter the evidenced energy-consumer co-payment per installed product. The estimator derives the exact minimum from the installation date, configuration, category and rated cooling capacity.", defaultValue: "0", source: "operator", required: true, min: "0", step: "any" },
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
    scenarios: ["14A"],
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
      { key: "scenario", label: "What are you sealing?", type: "select", unit: "scenario", help: "Choose the job first. Brand and model choices are then limited to approved products for this exact type of weather-sealing work.", defaultValue: "15A", source: "operator", required: true, options: WEATHER_SEALING_SCENARIO_OPTIONS },
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
      { key: "scenario", label: "Appliance scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry listing determines the appliance type.", defaultValue: "22A", source: "approved_product", required: true, options: REFRIGERATOR_SCENARIO_OPTIONS },
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
      { key: "scenario", label: "Television scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry television listing determines this scenario.", defaultValue: "24A", source: "approved_product", required: true, options: [{ value: "24A", label: "Supply an approved high-efficiency television (24A)" }] },
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
      { key: "scenario", label: "Clothes-dryer scenario", type: "select", unit: "scenario", help: "The exact Approved VEU Public Registry clothes-dryer listing determines this scenario.", defaultValue: "25A", source: "approved_product", required: true, options: [{ value: "25A", label: "Supply an approved energy-efficient clothes dryer (25A)" }] },
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
    activityCode: "27",
    title: "Public lighting upgrade",
    scenarios: ["27A", "27B", "27C"],
    formulaKey: "veu-part-27-equations-27.1-to-27.4/v2",
    sourcePages: "Version 25 pages 64-68, Equations 27.1-27.4 and Tables 27.2-27.9",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "27A or 27B VEU approval and installation-date window; the AEMO NEM load-table alternative remains unavailable without an authoritative connector",
      "governed upgrade LCP or Victorian load",
      "occupancy-sensor and programmable-dimmer controls",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Public-lighting scenario", type: "select", unit: "scenario", help: "Select 27A for a control device, 27B for other approved lighting equipment, or 27C for eligible removal without replacement.", defaultValue: "27A", source: "operator", required: true, options: [{ value: "27A", label: "27A, install a lighting control device" }, { value: "27B", label: "27B, replace lighting equipment" }, { value: "27C", label: "27C, remove eligible lighting without replacement" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "baseline_lcp_w", label: "Governed incumbent lamp circuit power", type: "decimal", unit: "W", help: "Use the exact applicable Victorian load, nominal device rating, Table 27.6 result, or ESC-determined LCP. Do not substitute raw lamp wattage.", defaultValue: "100", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "baseline_control_profile", label: "Incumbent control profile", type: "select", unit: "control", help: "Select the exact incumbent Table 27.7 control-device combination.", defaultValue: "none", source: "operator", required: true, options: SIMPLE_LIGHTING_CONTROL_OPTIONS },
      { key: "approved_upgrade_lcp_w", label: "Approved upgrade lamp circuit power", type: "decimal", unit: "W", help: "Populate the exact selected 27B product Victorian load, nominal device rating, or governed Table 27.6 LCP.", defaultValue: "50", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["27B"] }, omitWhenHidden: true },
      { key: "approved_upgrade_control_profile", label: "Installed approved-product control profile", type: "select", unit: "control", help: "Select the exact installed occupancy-sensor coverage. The server cross-checks the occupancy and programmable-dimmer capabilities against the selected 27A or 27B registry record.", defaultValue: "programmable_dimmer", source: "operator", required: true, options: SIMPLE_LIGHTING_CONTROL_OPTIONS, showWhen: { key: "scenario", oneOf: ["27A", "27B"] }, omitWhenHidden: true },
      { key: "incumbent_source_count", label: "Incumbent lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive number of identical incumbent lighting sources represented by the governed baseline LCP and control profile. Calculate heterogeneous incumbent lines separately.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
      { key: "upgrade_source_count", label: "Upgrade lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive installed upgrade count. Scenario 27A requires it to equal the incumbent count; replacement scenario 27B permits an independent quantity for the upgrade sum.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1", showWhen: { key: "scenario", notOneOf: ["27C"] }, omitWhenHidden: true },
      { key: "removal_requirements_confirmed", label: "27C removal and decommissioning evidence", type: "select", unit: "confirmation", help: "Confirm the eligible LED luminaire, or lamp and associated control gear, is removed and not replaced as prescribed.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "scenario", oneOf: ["27C"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "28",
    title: "Gas-heating ductwork upgrade",
    scenarios: ["28A", "28B"],
    formulaKey: "veu-part-28-equation-28.1/v1",
    sourcePages: "Version 25 pages 69-71, Equation 28.1 and Tables 28.2-28.3",
    productRegistry: "VEU",
    productPerformanceInputs: ["VEU category 28A or 28B", "AS/NZS 4859.1 R-value"],
    inputDefinitions: [
      { key: "scenario", label: "Ductwork scenario", type: "select", unit: "scenario", help: "Derive 28A flexible or 28B rigid ductwork from the exact approved-product category.", defaultValue: "28A", source: "approved_product", required: true, options: [{ value: "28A", label: "28A, flexible ductwork" }, { value: "28B", label: "28B, rigid ductwork" }] },
      { key: "location_class", label: "VEU climatic location", type: "select", unit: "location", help: "Resolve the exact metropolitan/regional and mild/cold/hot class from the installation postcode.", defaultValue: "metro_mild", source: "postcode_lookup", required: true, options: LOCATION_CLASS_OPTIONS },
      { key: "heater_output_status", label: "Heater thermal-output evidence", type: "select", unit: "status", help: "Select known when AS/NZS 5263.1.6 capacity evidence exists; otherwise use the prescribed unknown-output branch.", defaultValue: "known", source: "operator", required: true, options: [{ value: "known", label: "Known AS/NZS 5263.1.6 thermal output" }, { value: "unknown", label: "Thermal output unknown" }] },
      { key: "heater_thermal_output_kw", label: "Heater thermal output", type: "decimal", unit: "kW", help: "Enter the AS/NZS 5263.1.6 heater output. Known Part 28 outputs must be at least 10 kW; exact bands end at 18 and 28 kW.", defaultValue: "18", source: "operator", required: true, min: "10", step: "any", showWhen: { key: "heater_output_status", oneOf: ["known"] }, omitWhenHidden: true },
      { key: "r_value", label: "Approved ductwork R-value", type: "decimal", unit: "m2.K/W", help: "Populate the selected product's exact AS/NZS 4859.1 R-value. Part 28 requires at least 1.5.", defaultValue: "1.5", source: "approved_product", required: true, min: "1.5", step: "any" },
    ],
  },
  {
    activityCode: "30",
    title: "In-home display unit",
    scenarios: ["30A", "30B"],
    formulaKey: "veu-part-30-equation-30.1/v1",
    sourcePages: "Version 25 pages 72-75, Equation 30.1 and Table 30.2",
    productRegistry: "VEU",
    productPerformanceInputs: ["VEU category 30A or 30B"],
    inputDefinitions: [
      { key: "scenario", label: "In-home display scenario", type: "select", unit: "scenario", help: "The exact VEU-approved product determines whether it connects to the AMI meter or separate sensing equipment.", defaultValue: "30A", source: "approved_product", required: true, options: [{ value: "30A", label: "Display connected to the residential AMI meter (30A)" }, { value: "30B", label: "Display connected to separate residential sensing equipment (30B)" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "gas_reticulation", label: "Reticulated-gas area", type: "select", unit: "status", help: "Resolve the official reticulated-gas classification from the installation postcode.", defaultValue: "reticulated", source: "postcode_lookup", required: true, options: [{ value: "reticulated", label: "Reticulated gas area" }, { value: "not_reticulated", label: "Non-reticulated gas area" }] },
      { key: "installation_count", label: "Identical display-unit count", type: "decimal", unit: "units", help: "Enter the number of installations using this exact approved model and postcode classification.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
    ],
  },
  {
    activityCode: "31",
    title: "High-efficiency motor",
    scenarios: ["31A"],
    internalExecutableScenarios: ["31B"],
    formulaKey: "veu-part-31-equations-31.1-and-31.2/v2",
    sourcePages: "Version 25 pages 76-80, Equations 31.1-31.2 and Tables 31.3-31.5",
    productRegistry: "GEMS",
    productPerformanceInputs: ["31A exact GEMS registration", "rated motor output"],
    inputDefinitions: [
      { key: "scenario", label: "Motor scenario", type: "select", unit: "scenario", help: "This released selection contract supports only 31A and requires the exact current GEMS-registered MEPS motor. The 31B VEU pathway remains hidden until its authoritative selection connector is released.", defaultValue: "31A", source: "approved_product", required: true, options: [{ value: "31A", label: "31A, GEMS-listed high-efficiency motor" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "rated_output_kw", label: "Rated motor output", type: "select", unit: "kW", help: "Populate the exact AS 60034.1 rated output from the selected official product. Only the prescribed Table 31.4 and 31.5 output points are accepted.", defaultValue: "0.75", source: "approved_product", required: true, options: ["0.75", "1.1", "1.5", "2.2", "3", "4", "5.5", "7.5", "11", "15", "18.5", "22", "30", "37", "45", "55", "75", "90", "110", "132", "150", "185"].map((value) => ({ value, label: `${value} kW` })) },
      { key: "installation_count", label: "Identical motor count", type: "decimal", unit: "motors", help: "Enter the number of installations using this exact official motor model and postcode classification.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
      { key: "co_payment_per_motor_aud", label: "Co-payment per motor", type: "decimal", unit: "AUD including GST", help: "Part 31 requires a minimum co-payment of $200 including GST per motor.", defaultValue: "200", source: "operator", required: true, min: "200", step: "any" },
    ],
  },
  {
    activityCode: "32",
    title: "High-efficiency refrigerated cabinet",
    scenarios: ["32A(i)", "32A(ii)", "32A(iii)"],
    formulaKey: "veu-part-32-equations-32.2-to-32.4/v1",
    sourcePages: "Version 25 pages 81-87, Equations 32.2-32.4 and Tables 32.4-32.7; expired scenario 32A excluded",
    productRegistry: "GEMS",
    productPerformanceInputs: ["GEMS class", "EEI", "TEC", "TDA or net volume", "duty type"],
    inputDefinitions: [
      { key: "scenario", label: "Current refrigerated-cabinet scenario", type: "select", unit: "scenario", help: "Derive the current scenario from the exact GEMS product class. Historical scenario 32A expired on 30 June 2022 and is not offered.", defaultValue: "32A(i)", source: "approved_product", required: true, options: [{ value: "32A(i)", label: "32A(i), refrigerated display or gelato cabinet" }, { value: "32A(ii)", label: "32A(ii), ice-cream freezer cabinet" }, { value: "32A(iii)", label: "32A(iii), refrigerated storage cabinet" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "product_class", label: "GEMS 2020 product class", type: "select", unit: "class", help: "Populate the exact class from the current GEMS registration. The estimator verifies the class against the selected current scenario.", defaultValue: "1", source: "approved_product", required: true, options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"].map((value) => ({ value, label: `Class ${value}` })) },
      { key: "product_eei", label: "Energy Efficiency Index", type: "decimal", unit: "EEI", help: "Populate the exact registered EEI. It must be below the applicable upgrade EEI, 51 for class 5 and 81 otherwise.", defaultValue: "50", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "total_display_area_m2", label: "Total display area", type: "decimal", unit: "m2", help: "Populate the exact GEMS total display area for scenario 32A(i). The 3.3 m2 boundary controls lifetime for classes 7, 8 and 11.", defaultValue: "3", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["32A(i)"] }, omitWhenHidden: true },
      { key: "tec_kwh_per_24h", label: "Total Energy Consumption", type: "decimal", unit: "kWh/24h", help: "Populate the exact GEMS Total Energy Consumption of the installed cabinet.", defaultValue: "1", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "net_volume_litres", label: "Net volume", type: "decimal", unit: "L", help: "Populate the exact GEMS net volume for scenario 32A(ii) or 32A(iii).", defaultValue: "500", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["32A(ii)", "32A(iii)"] }, omitWhenHidden: true },
      { key: "duty_type", label: "Registered duty type", type: "select", unit: "duty", help: "Populate the registered storage-cabinet duty and temperature application used by Table 32.7.", defaultValue: "normal_duty", source: "approved_product", required: true, options: [{ value: "light_duty_chiller", label: "Light Duty chiller" }, { value: "light_duty_freezer", label: "Light Duty freezer" }, { value: "normal_duty", label: "Normal Duty chiller or freezer" }, { value: "heavy_duty", label: "Heavy Duty chiller or freezer" }], showWhen: { key: "scenario", oneOf: ["32A(iii)"] }, omitWhenHidden: true },
      { key: "installation_count", label: "Identical cabinet count", type: "decimal", unit: "cabinets", help: "Enter the number of installations using this exact GEMS product and postcode classification.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
    ],
  },
  {
    activityCode: "33",
    title: "Refrigeration or ventilation fan motor",
    scenarios: ["33A"],
    internalExecutableScenarios: ["33B"],
    formulaKey: "veu-part-33-equations-33.1-and-33.2/v1",
    sourcePages: "Version 25 pages 88-90, Equations 33.1-33.2 and Tables 33.2-33.4",
    productRegistry: "VEU",
    productPerformanceInputs: ["VEU category 33A", "rotor type", "input and output power"],
    inputDefinitions: [
      { key: "scenario", label: "Fan-motor scenario", type: "select", unit: "scenario", help: "The released calculator derives 33A from the exact approved-product category. Activity 33B remains fail-closed until an exact 33B Public Registry contract is available.", defaultValue: "33A", source: "approved_product", required: true, options: [{ value: "33A", label: "33A, refrigerated cabinet or cold room" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "rotor_motor_type", label: "Rotor motor type", type: "select", unit: "rotor", help: "Populate the selected motor's exact internal or external rotor type.", defaultValue: "internal", source: "approved_product", required: true, options: [{ value: "internal", label: "Internal rotor" }, { value: "external", label: "External rotor" }] },
      { key: "input_power_w", label: "New fan input power", type: "decimal", unit: "W", help: "Populate NFIP, the exact approved new motor input power. External-rotor products must not exceed 800 W input.", defaultValue: "100", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "output_power_w", label: "Rated motor output", type: "decimal", unit: "W", help: "Populate the exact approved rated motor output. Internal-rotor products must not exceed 600 W output.", defaultValue: "100", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "refrigeration_application", label: "Refrigeration application", type: "select", unit: "application", help: "Select the evidenced installed application used to resolve the exact Table 33.3 COP.", defaultValue: "refrigerated_cabinet", source: "operator", required: true, options: [{ value: "refrigerated_cabinet", label: "Refrigerated cabinet" }, { value: "cold_room_below_zero_c", label: "Cold room below 0 C" }, { value: "cold_room_at_or_above_zero_c", label: "Cold room at or above 0 C" }], showWhen: { key: "scenario", oneOf: ["33A"] }, omitWhenHidden: true },
      { key: "installation_count", label: "Identical fan-motor count", type: "decimal", unit: "motors", help: "Enter the number of installations using this exact approved motor, application and postcode classification.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
    ],
  },
  {
    activityCode: "34",
    title: "Building-based lighting upgrade at a site not required to comply with Part J6",
    scenarios: ["34A", "34B", "34C", "34D", "34E"],
    formulaKey: "veu-part-34-equations-34.1-to-34.4-non-j6/v2",
    sourcePages: "Version 25 pages 91-97, Equations 34.1-34.4 and Tables 34.2-34.10; Part J6 refurbishment branch not enabled",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "34A to 34C VEU approval and installation-date window",
      "governed upgrade LCP and rated lifetime where applicable",
      "occupancy, daylight, programmable, manual and voltage-reduction controls",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Building-lighting scenario", type: "select", unit: "scenario", help: "Select the exact Part 34 pathway. Scenarios 34D and 34E do not install an approved product.", defaultValue: "34A", source: "operator", required: true, options: [{ value: "34A", label: "34A, install a lighting control device other than a VRU" }, { value: "34B", label: "34B, install a voltage reduction unit" }, { value: "34C", label: "34C, replace other lighting equipment" }, { value: "34D", label: "34D, delamp no more than half the lamps" }, { value: "34E", label: "34E, remove eligible lighting without replacement" }] },
      { key: "site_part_j6_status", label: "Building Code Part J6 status", type: "select", unit: "status", help: "This bounded deterministic line-item engine supports only upgrades not forming part of a refurbishment required to comply with Part J6. Part J6 work remains fail closed.", defaultValue: "not_required", source: "operator", required: true, options: [{ value: "not_required", label: "Upgrade is not part of a refurbishment required to comply with Part J6" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "space_air_conditioned", label: "Air-conditioned space", type: "select", unit: "status", help: "Table 34.3 and Table 34.4 apply AM 1.05 in an air-conditioned space and 1.00 otherwise.", defaultValue: "no", source: "operator", required: true, options: YES_NO_OPTIONS },
      { key: "annual_operating_hours", label: "Annual operating-hours branch", type: "select", unit: "hours/year", help: "Select the exact evidenced value from Table 34.6 or Table 34.10. Arbitrary annual hours are not accepted.", defaultValue: "3000", source: "operator", required: true, options: PART_34_ANNUAL_HOURS_OPTIONS },
      { key: "baseline_lcp_w", label: "Governed incumbent lamp circuit power", type: "decimal", unit: "W", help: "Use the exact Table 34.8 incumbent LCP or an ESC-determined value. Incumbent LED LCP is permitted only where the specification permits it.", defaultValue: "100", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      ...part34ControlInputDefinitions("baseline", "Incumbent", "operator"),
      { key: "approved_upgrade_lcp_w", label: "Approved upgrade lamp circuit power", type: "decimal", unit: "W", help: "Populate the exact selected 34C product LCP or ESC-determined value. Product-sourced power remains read only.", defaultValue: "50", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["34C"] }, omitWhenHidden: true },
      ...part34ControlInputDefinitions("approved_upgrade", "Approved upgrade", "approved_product", ["34A", "34B", "34C"]),
      { key: "retained_upgrade_lcp_w", label: "Retained LCP per lighting source", type: "decimal", unit: "W/source", help: "Enter the exact lamp circuit power for each identical retained lighting source after eligible 34D delamping. The estimator multiplies this per-source value by upgrade_source_count; calculate heterogeneous retained sources as separate lines.", defaultValue: "50", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["34D"] }, omitWhenHidden: true },
      ...part34ControlInputDefinitions("retained_upgrade", "Retained upgrade", "operator", ["34D"]),
      { key: "replacement_method", label: "34C replacement method", type: "select", unit: "method", help: "Select the exact Table 34.9 asset-life branch.", defaultValue: "luminaire_replacement", source: "operator", required: true, options: [{ value: "luminaire_replacement", label: "Luminaire replacement, 10 years" }, { value: "modification", label: "Modification, 4 years" }, { value: "retrofit", label: "Retrofit, approved lifetime divided by annual hours, capped at 4 years" }, { value: "other", label: "Other, incumbent lifetime divided by annual hours, capped at 4 years" }], showWhen: { key: "scenario", oneOf: ["34C"] }, omitWhenHidden: true },
      { key: "upgrade_rated_lifetime_hours", label: "Approved upgrade lamp rated lifetime", type: "decimal", unit: "hours", help: "Populate the selected approved retrofit lamp's governed lifetime. Table 34.9 caps the formula input at 30,000 hours and the result at four years.", defaultValue: "30000", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "replacement_method", oneOf: ["retrofit"] }, omitWhenHidden: true },
      { key: "incumbent_rated_lifetime_hours", label: "Incumbent lamp rated lifetime", type: "decimal", unit: "hours", help: "Enter the evidenced manufacturer-rated incumbent lifetime for the Table 34.9 other-case branch. The estimator caps it at 30,000 hours and four years.", defaultValue: "12000", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "replacement_method", oneOf: ["other"] }, omitWhenHidden: true },
      { key: "incumbent_source_count", label: "Incumbent lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive number of identical incumbent lighting sources represented by this baseline LCP and control line. Calculate heterogeneous incumbent lines separately.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
      { key: "upgrade_source_count", label: "Upgrade lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive installed or retained upgrade count. Scenarios 34A and 34B require equality with the incumbent count; 34C permits an independent replacement sum; 34D must retain at least half but fewer than all incumbent sources.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1", showWhen: { key: "scenario", notOneOf: ["34E"] }, omitWhenHidden: true },
      { key: "vru_compatibility_confirmed", label: "34B VRU compatibility evidence", type: "select", unit: "confirmation", help: "Confirm the voltage reduction unit is not installed with electronic ballasts, electronic drivers or LED lighting.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "scenario", oneOf: ["34B"] }, omitWhenHidden: true },
      { key: "removal_requirements_confirmed", label: "Part 34 removal and decommissioning evidence", type: "select", unit: "confirmation", help: "Confirm the exact 34D delamping limit and control-gear removal, or the exact 34E luminaire or lamp-and-control-gear removal requirements.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "scenario", oneOf: ["34D", "34E"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "35",
    title: "Non-building-based lighting upgrade",
    scenarios: ["35A", "35B", "35C", "35D"],
    formulaKey: "veu-part-35-equations-35.1-to-35.4/v2",
    sourcePages: "Version 25 pages 98-103, Equations 35.1-35.4 and Tables 35.2-35.9",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "35A or 35B VEU approval and installation-date window",
      "governed upgrade LCP and rated lifetime where applicable",
      "occupancy-sensor and programmable-dimmer controls",
    ],
    inputDefinitions: [
      { key: "scenario", label: "Non-building-lighting scenario", type: "select", unit: "scenario", help: "Select the exact Part 35 pathway. Scenarios 35C and 35D do not install an approved product.", defaultValue: "35A", source: "operator", required: true, options: [{ value: "35A", label: "35A, install a lighting control device" }, { value: "35B", label: "35B, replace other lighting equipment" }, { value: "35C", label: "35C, delamp no more than half the lamps" }, { value: "35D", label: "35D, remove eligible lighting without replacement" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "area_type", label: "Table 35.9 area type", type: "select", unit: "area", help: "Road and public or outdoor spaces that are not sports fields use 4,500 hours. Every other eligible case uses 1,000 hours.", defaultValue: "road_or_public_outdoor_space", source: "operator", required: true, options: [{ value: "road_or_public_outdoor_space", label: "Road or public/outdoor non-sports space, 4,500 hours" }, { value: "other", label: "Other eligible area, 1,000 hours" }] },
      { key: "baseline_lcp_w", label: "Governed incumbent lamp circuit power", type: "decimal", unit: "W", help: "Use the exact Table 35.6 incumbent LCP or an ESC-determined value. Do not substitute raw lamp wattage.", defaultValue: "100", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "baseline_control_profile", label: "Incumbent control profile", type: "select", unit: "control", help: "Select the exact incumbent Table 35.7 control-device combination.", defaultValue: "none", source: "operator", required: true, options: SIMPLE_LIGHTING_CONTROL_OPTIONS },
      { key: "approved_upgrade_lcp_w", label: "Approved upgrade lamp circuit power", type: "decimal", unit: "W", help: "Populate the exact selected 35B product Table 35.6 or ESC-determined LCP.", defaultValue: "50", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["35B"] }, omitWhenHidden: true },
      { key: "approved_upgrade_control_profile", label: "Installed approved-product control profile", type: "select", unit: "control", help: "Select the exact installed occupancy-sensor coverage. The server cross-checks the occupancy and programmable-dimmer capabilities against the selected 35A or 35B registry record.", defaultValue: "occupancy_1_to_2", source: "operator", required: true, options: SIMPLE_LIGHTING_CONTROL_OPTIONS, showWhen: { key: "scenario", oneOf: ["35A", "35B"] }, omitWhenHidden: true },
      { key: "retained_upgrade_lcp_w", label: "Retained LCP per lighting source", type: "decimal", unit: "W/source", help: "Enter the exact lamp circuit power for each identical retained lighting source after eligible 35C delamping. The estimator multiplies this per-source value by upgrade_source_count; calculate heterogeneous retained sources as separate lines.", defaultValue: "50", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["35C"] }, omitWhenHidden: true },
      { key: "retained_upgrade_control_profile", label: "Retained upgrade control profile", type: "select", unit: "control", help: "Select the exact Table 35.7 control combination remaining after eligible delamping.", defaultValue: "none", source: "operator", required: true, options: SIMPLE_LIGHTING_CONTROL_OPTIONS, showWhen: { key: "scenario", oneOf: ["35C"] }, omitWhenHidden: true },
      { key: "replacement_method", label: "35B replacement method", type: "select", unit: "method", help: "Select the exact Table 35.8 asset-life branch.", defaultValue: "luminaire_replacement", source: "operator", required: true, options: [{ value: "luminaire_replacement", label: "Luminaire replacement, 10 years" }, { value: "modification", label: "Modification, 5 years" }, { value: "retrofit", label: "Retrofit, approved lifetime divided by annual hours, capped at 5 years" }, { value: "other", label: "Other, incumbent lifetime divided by annual hours, capped at 5 years" }], showWhen: { key: "scenario", oneOf: ["35B"] }, omitWhenHidden: true },
      { key: "upgrade_rated_lifetime_hours", label: "Approved upgrade lamp rated lifetime", type: "decimal", unit: "hours", help: "Populate the selected approved retrofit lamp's governed lifetime. Table 35.8 caps the formula input at 30,000 hours and the result at five years.", defaultValue: "30000", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "replacement_method", oneOf: ["retrofit"] }, omitWhenHidden: true },
      { key: "incumbent_rated_lifetime_hours", label: "Incumbent lamp rated lifetime", type: "decimal", unit: "hours", help: "Enter the evidenced manufacturer-rated incumbent lifetime for the Table 35.8 other-case branch. The estimator caps it at 30,000 hours and five years.", defaultValue: "12000", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "replacement_method", oneOf: ["other"] }, omitWhenHidden: true },
      { key: "incumbent_source_count", label: "Incumbent lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive number of identical incumbent lighting sources represented by this baseline LCP and control line. Calculate heterogeneous incumbent lines separately.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
      { key: "upgrade_source_count", label: "Upgrade lighting-source count", type: "decimal", unit: "sources", help: "Enter the positive installed or retained upgrade count. Scenario 35A requires equality with the incumbent count; 35B permits an independent replacement sum; 35C must retain at least half but fewer than all incumbent sources.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1", showWhen: { key: "scenario", notOneOf: ["35D"] }, omitWhenHidden: true },
      { key: "removal_requirements_confirmed", label: "Part 35 removal and decommissioning evidence", type: "select", unit: "confirmation", help: "Confirm the exact 35C delamping limit and control-gear removal, or the exact 35D luminaire or lamp-and-control-gear removal requirements.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "scenario", oneOf: ["35C", "35D"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "36",
    title: "Water-efficient pre-rinse spray valve",
    scenarios: ["36A(i)", "36A(ii)"],
    formulaKey: "veu-part-36-equation-36.1/v1",
    sourcePages: "Version 25 pages 103-105, Equation 36.1 and Table 36.3",
    productRegistry: "VEU",
    productPerformanceInputs: ["VEU category 36A proving the six-star WELS product requirement"],
    inputDefinitions: [
      { key: "scenario", label: "Pre-rinse spray-valve scenario", type: "select", unit: "scenario", help: "Choose 36A(i) for an existing valve permanently disconnected or 36A(ii) for a new fitting where none was previously installed.", defaultValue: "36A(i)", source: "operator", required: true, options: [{ value: "36A(i)", label: "36A(i), permanently disconnect existing valve" }, { value: "36A(ii)", label: "36A(ii), install where no valve existed" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve metropolitan or regional Victoria from the official installation-postcode table.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "installation_count", label: "Identical valve count", type: "decimal", unit: "valves", help: "Enter the number of installations using this exact approved model and postcode classification.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
    ],
  },
  {
    activityCode: "37",
    title: "High-efficiency gas-fired steam boiler",
    scenarios: ["37A"],
    formulaKey: "veu-part-37-equation-37.1/v1",
    sourcePages: "Version 25 pages 105-108, Equation 37.1 and Tables 37.2-37.3",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "incumbent_nominal_gas_consumption_mj_per_h", label: "Incumbent nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced total nominal gas consumption of the incumbent steam boiler equipment.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "replacement_nominal_gas_consumption_mj_per_h", label: "Replacement nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced total nominal gas consumption of the replacement steam boiler equipment. The formula uses the lower incumbent or replacement value.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "incumbent_equipment_age_years", label: "Incumbent steam-boiler age", type: "decimal", unit: "years", help: "Enter the evidenced interval between manufacture and decommissioning. Part 37 requires at least 10 years.", defaultValue: "10", source: "operator", required: true, min: "10", step: "any" },
      { key: "incumbent_manufacture_period", label: "Incumbent manufacture period", type: "select", unit: "period", help: "Use the incumbent boiler nameplate or other governed evidence to select the Table 37.3 year branch.", defaultValue: "1990_or_later", source: "operator", required: true, options: [{ value: "1989_or_earlier", label: "Marked 1989 or earlier" }, { value: "1990_or_later", label: "Marked 1990 or later" }] },
      { key: "incumbent_burner_age_band", label: "Incumbent burner age band", type: "select", unit: "age band", help: "Select the evidenced Table 37.3 burner-installation age branch.", defaultValue: "up_to_10_years", source: "operator", required: true, options: [{ value: "over_10_years", label: "Installed over 10 years ago" }, { value: "up_to_10_years", label: "Installed up to and including 10 years ago" }] },
      { key: "replacement_gross_thermal_efficiency_percent", label: "Replacement gross thermal efficiency", type: "decimal", unit: "%", help: "Enter the governed BS 845, EU 813/2013 certification or eligible condensing-boiler manufacturer value. Part 37 requires at least 80%.", defaultValue: "85", source: "operator", required: true, min: "80", max: "100", step: "any" },
      { key: "replacement_control_system", label: "Replacement control system", type: "select", unit: "control", help: "Record the installed control evidence. Above 3,700 MJ/h electronic gas/air ratio control is required; above 7,500 MJ/h a flue-gas-sensor signal for combustion trim is required.", defaultValue: "not_required", source: "operator", required: true, options: [{ value: "not_required", label: "Not required at this capacity" }, { value: "electronic_gas_air_ratio", label: "Electronic gas/air ratio control" }, { value: "electronic_gas_air_ratio_with_combustion_trim", label: "Electronic gas/air ratio control with combustion-trim flue signal" }] },
    ],
  },
  {
    activityCode: "38",
    title: "High-efficiency gas-fired hot-water boiler or water heater",
    scenarios: ["38A(i)", "38A(ii)", "38A(iii)"],
    formulaKey: "veu-part-38-equation-38.1/v1",
    sourcePages: "Version 25 pages 108-111, Equation 38.1 and Tables 38.2-38.3",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "scenario", label: "Incumbent equipment scenario", type: "select", unit: "scenario", help: "Select the exact decommissioned equipment class in Part 38.", defaultValue: "38A(ii)", source: "operator", required: true, options: [{ value: "38A(i)", label: "38A(i), replacing a steam boiler" }, { value: "38A(ii)", label: "38A(ii), replacing a hot-water boiler" }, { value: "38A(iii)", label: "38A(iii), replacing a water heater" }] },
      { key: "incumbent_nominal_gas_consumption_mj_per_h", label: "Incumbent nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced total nominal gas consumption of the incumbent equipment.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "replacement_nominal_gas_consumption_mj_per_h", label: "Replacement nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced total nominal gas consumption of the replacement equipment. The formula uses the lower incumbent or replacement value.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "incumbent_equipment_age_years", label: "Incumbent equipment age", type: "decimal", unit: "years", help: "Enter the evidenced interval between manufacture and decommissioning. Part 38 requires at least 10 years.", defaultValue: "10", source: "operator", required: true, min: "10", step: "any" },
      { key: "part_j5_2d_refurbishment", label: "Part J5.2d refurbishment branch", type: "select", unit: "status", help: "Select yes only when the installed boiler or heater is part of an air-conditioning system serving an area upgraded in a refurbishment required to comply with Building Code Part J5.2d.", defaultValue: "no", source: "operator", required: true, options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
      { key: "incumbent_manufacture_period", label: "Incumbent manufacture period", type: "select", unit: "period", help: "Use the incumbent equipment nameplate or governed evidence to select the Table 38.3 year branch.", defaultValue: "1990_or_later", source: "operator", required: true, options: [{ value: "1989_or_earlier", label: "Marked 1989 or earlier" }, { value: "1990_or_later", label: "Marked 1990 or later" }], showWhen: { key: "part_j5_2d_refurbishment", oneOf: ["no"] }, omitWhenHidden: true },
      { key: "incumbent_burner_age_band", label: "Incumbent burner age band", type: "select", unit: "age band", help: "Select the evidenced Table 38.3 burner-installation age branch.", defaultValue: "up_to_10_years", source: "operator", required: true, options: [{ value: "over_10_years", label: "Installed over 10 years ago" }, { value: "up_to_10_years", label: "Installed up to and including 10 years ago" }], showWhen: { key: "part_j5_2d_refurbishment", oneOf: ["no"] }, omitWhenHidden: true },
      { key: "replacement_gross_thermal_efficiency_percent", label: "Replacement gross thermal efficiency", type: "decimal", unit: "%", help: "Enter the governed certified efficiency. Table 38.3 only prescribes DEI branches from 85% upward.", defaultValue: "90", source: "operator", required: true, min: "85", max: "100", step: "any" },
      { key: "replacement_control_system", label: "Replacement control system", type: "select", unit: "control", help: "Record the installed control evidence. Above 3,700 MJ/h electronic gas/air ratio control is required; above 7,500 MJ/h a flue-gas-sensor signal for combustion trim is required.", defaultValue: "not_required", source: "operator", required: true, options: [{ value: "not_required", label: "Not required at this capacity" }, { value: "electronic_gas_air_ratio", label: "Electronic gas/air ratio control" }, { value: "electronic_gas_air_ratio_with_combustion_trim", label: "Electronic gas/air ratio control with combustion-trim flue signal" }] },
    ],
  },
  {
    activityCode: "39",
    title: "Electronic gas/air ratio control",
    scenarios: ["39A"],
    formulaKey: "veu-part-39-equation-39.1/v1",
    sourcePages: "Version 25 pages 111-113, Equation 39.1 and Table 39.2",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "nominal_gas_consumption_mj_per_h", label: "Boiler or heater nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced nominal gas consumption. Table 39.2 caps the governed value at 11,400 MJ/h.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "eligibility_requirements_confirmed", label: "Part 39 installation requirements", type: "select", unit: "confirmation", help: "Confirm the Type B appliance and compatible electronic gas/air ratio control requirements in Table 39.1 are evidenced.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }] },
    ],
  },
  {
    activityCode: "40",
    title: "Combustion trim system",
    scenarios: ["40A"],
    formulaKey: "veu-part-40-equation-40.1/v1",
    sourcePages: "Version 25 pages 113-115, Equation 40.1 and Table 40.2",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "equipment_type", label: "Boiler or heater type", type: "select", unit: "equipment", help: "Select the Table 40.2 equipment branch.", defaultValue: "steam_boiler", source: "operator", required: true, options: [{ value: "steam_boiler", label: "Steam boiler" }, { value: "hot_water_boiler_or_water_heater", label: "Hot-water boiler or water heater" }] },
      { key: "nominal_gas_consumption_mj_per_h", label: "Boiler or heater nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced nominal gas consumption. Table 40.2 caps the governed value at 11,400 MJ/h.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "eligibility_requirements_confirmed", label: "Part 40 installation requirements", type: "select", unit: "confirmation", help: "Confirm the Type B appliance, electronic gas/air ratio control, flue-gas sensor, control panel and compatible damper or variable-speed-drive requirements in Table 40.1 are evidenced.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }] },
    ],
  },
  {
    activityCode: "41",
    title: "Gas-fired burner upgrade",
    scenarios: ["41A"],
    formulaKey: "veu-part-41-equation-41.1/v1",
    sourcePages: "Version 25 pages 115-117, Equation 41.1 and Table 41.2",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "incumbent_nominal_gas_consumption_mj_per_h", label: "Incumbent equipment nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced nominal gas consumption with the incumbent burner installed.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "replacement_nominal_gas_consumption_mj_per_h", label: "Replacement equipment nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced nominal gas consumption with the replacement burner installed. The formula uses the lower incumbent or replacement value, capped at 11,400 MJ/h.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "incumbent_burner_age_years", label: "Incumbent burner age", type: "decimal", unit: "years", help: "Enter the evidenced interval between burner manufacture and decommissioning. Part 41 requires at least 10 years.", defaultValue: "10", source: "operator", required: true, min: "10", step: "any" },
      { key: "replacement_control_system", label: "Replacement burner control system", type: "select", unit: "control", help: "Above 3,700 MJ/h, Part 41 requires electronic gas/air ratio control capable of receiving a flue-gas-sensor signal.", defaultValue: "not_required", source: "operator", required: true, options: [{ value: "not_required", label: "Not required at this capacity" }, { value: "electronic_gas_air_ratio_with_flue_signal", label: "Electronic gas/air ratio control with flue-signal capability" }] },
    ],
  },
  {
    activityCode: "42",
    title: "Boiler economizer",
    scenarios: ["42A(i)", "42A(ii)"],
    formulaKey: "veu-part-42-equation-42.1/v1",
    sourcePages: "Version 25 pages 117-119, Equation 42.1 and Table 42.2",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "scenario", label: "Economizer scenario", type: "select", unit: "scenario", help: "Scenario 42A(i) is a condensing economizer; 42A(ii) is a non-condensing economizer and is limited to steam boilers.", defaultValue: "42A(i)", source: "operator", required: true, options: [{ value: "42A(i)", label: "42A(i), condensing economizer" }, { value: "42A(ii)", label: "42A(ii), non-condensing economizer" }] },
      { key: "equipment_type", label: "Boiler or heater type", type: "select", unit: "equipment", help: "Select the Table 42.2 equipment branch. Scenario 42A(ii) is only eligible for a steam boiler.", defaultValue: "steam_boiler", source: "operator", required: true, options: [{ value: "steam_boiler", label: "Steam boiler" }, { value: "hot_water_boiler_or_water_heater", label: "Hot-water boiler or water heater" }] },
      { key: "nominal_gas_consumption_mj_per_h", label: "Boiler or heater nominal gas consumption", type: "decimal", unit: "MJ/h", help: "Enter the evidenced nominal gas consumption of the equipment on which the economizer is installed. Part 42 applies no 11,400 MJ/h cap.", defaultValue: "1000", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "eligibility_requirements_confirmed", label: "Part 42 installation requirements", type: "select", unit: "confirmation", help: "Confirm the Type B appliance, AS 1228, stack and automatic minimum-flow-control requirements for the selected scenario are evidenced.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }] },
    ],
  },
  {
    activityCode: "43",
    title: "Cold-room refrigeration upgrade",
    scenarios: ["43A", "43B(i)", "43B(ii)"],
    formulaKey: "veu-part-43-equations-43.1-to-43.3/v1",
    sourcePages: "Version 25 pages 119-124, Equations 43.1-43.3 and Tables 43.2-43.5",
    productRegistry: "none",
    productPerformanceInputs: [],
    inputDefinitions: [
      { key: "scenario", label: "Cold-room scenario", type: "select", unit: "scenario", help: "Select the exact installed-parts configuration in Table 43.1.", defaultValue: "43A", source: "operator", required: true, options: [{ value: "43A", label: "43A, electronic expansion valve and superheat controller" }, { value: "43B(i)", label: "43B(i), at least three specified parts including a primary part" }, { value: "43B(ii)", label: "43B(ii), all specified parts" }] },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "operating_temperature_band", label: "Cold-room operating temperature", type: "select", unit: "temperature band", help: "Use the evidenced intended operating temperature. Freezers below 0 C receive the Table 43 temperature factor of 1.4.", defaultValue: "at_or_above_zero_c", source: "operator", required: true, options: [{ value: "at_or_above_zero_c", label: "At or above 0 C" }, { value: "below_zero_c", label: "Below 0 C, freezer" }] },
      { key: "internal_floor_area_m2", label: "Internal cold-room floor area", type: "decimal", unit: "m2", help: "Enter the evidenced internal floor area. Part 43 requires at least 4 m2 and applies exact size-factor bands at 9 m2 and 24 m2.", defaultValue: "10", source: "operator", required: true, min: "4", step: "any" },
      { key: "system_count", label: "Identical cold-room system count", type: "decimal", unit: "systems", help: "Enter the number of systems sharing this exact scenario, floor area, temperature and postcode classification. Calculate heterogeneous systems as separate line items.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
      { key: "eligible_parts_configuration_confirmed", label: "Eligible parts configuration", type: "select", unit: "confirmation", help: "Confirm the installed components meet the complete Table 43.1 configuration for the selected scenario.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }] },
      { key: "co_payment_per_cold_room_aud", label: "Co-payment per cold room", type: "decimal", unit: "AUD including GST", help: "Part 43B requires at least $500 including GST per cold room from 1 February 2025.", defaultValue: "500", source: "operator", required: true, min: "500", step: "any", showWhen: { key: "scenario", oneOf: ["43B(i)", "43B(ii)"] }, omitWhenHidden: true },
    ],
  },
  {
    activityCode: "44",
    title: "Commercial or industrial air-source heat-pump water heater",
    scenarios: ["44A(i)", "44A(ii)", "44A(iii)"],
    formulaKey: "veu-part-44-equations-44.1-to-44.3-guide-v2.2/v1",
    sourcePages: "Version 25 pages 124-131, Equations 44.1-44.3 and Tables 44.2-44.6; Product Application Guide v2.2 Appendix A pages 19-20",
    productRegistry: "VEU",
    productPerformanceInputs: [
      "VEU category 44A and approval window",
      "number of heat pumps and tanks",
      "total heat-pump thermal capacity and storage volume",
      "zone-specific annual energy savings, HPElec, HPGas and ComPeakLoad",
      "refrigerant GWP and charge",
    ],
    supportingSources: [CREDITEX_VEU_PART_44_APPLICATION_GUIDE],
    inputDefinitions: [
      { key: "scenario", label: "Part 44 installation scenario", type: "select", unit: "scenario", help: "Choose the evidenced incumbent pathway: gas replacement, electric-resistance replacement, or a new installation.", defaultValue: "44A(i)", source: "operator", required: true, options: [{ value: "44A(i)", label: "44A(i), decommission gas product" }, { value: "44A(ii)", label: "44A(ii), decommission electric-resistance product" }, { value: "44A(iii)", label: "44A(iii), new installation" }] },
      { key: "climate_zone", label: "AS/NZS 4234 climate zone", type: "select", unit: "zone", help: "Resolve climate zone 4 or 5 from the official installation-postcode table. This selects the exact approved guide outputs.", defaultValue: "4", source: "postcode_lookup", required: true, options: CLIMATE_ZONE_OPTIONS },
      { key: "storage_configuration", label: "Storage configuration", type: "select", unit: "configuration", help: "Existing-storage reuse is permitted only for 44A(i) and 44A(ii) with the Table 44.3 evidence and sets lifetime to 10 years; otherwise lifetime is 15 years.", defaultValue: "modelled_storage", source: "operator", required: true, options: [{ value: "modelled_storage", label: "Install modelled storage components" }, { value: "existing_storage", label: "Reuse eligible existing storage" }] },
      { key: "number_of_heat_pumps", label: "Approved heat-pump count", type: "decimal", unit: "heat pumps", help: "Populate the exact number of heat pumps in the selected VEU-approved modelled system.", defaultValue: "1", source: "approved_product", required: true, min: "1", step: "1" },
      { key: "number_of_tanks", label: "Approved tank count", type: "decimal", unit: "tanks", help: "Populate the exact number of tanks in the selected VEU-approved modelled system.", defaultValue: "1", source: "approved_product", required: true, min: "1", step: "1" },
      { key: "total_heat_pump_thermal_capacity_kw", label: "Total heat-pump thermal capacity", type: "decimal", unit: "kW", help: "Populate the exact selected-product total heat-pump thermal capacity. The estimator derives average capacity and the official capacity/load factors.", defaultValue: "10", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "existing_system_thermal_capacity_kw", label: "Existing-system thermal capacity", type: "decimal", unit: "kW", help: "Enter the evidenced incumbent-system thermal capacity used by the Table 44.4 or 44.5 Capacity Factor.", defaultValue: "10", source: "operator", required: true, min: "0", minExclusive: true, step: "any", showWhen: { key: "scenario", oneOf: ["44A(i)", "44A(ii)"] }, omitWhenHidden: true },
      { key: "total_storage_volume_litres", label: "Total insulated storage volume", type: "decimal", unit: "L", help: "Populate the selected modelled system's exact total storage volume. Average volume per tank must be at least 425 L.", defaultValue: "425", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "annual_energy_savings_percent", label: "Zone-specific annual energy savings", type: "decimal", unit: "%", help: "Populate the exact approved HP4-Au or HP5-Au annual energy savings. Part 44 requires at least 60%.", defaultValue: "60", source: "approved_product", required: true, min: "60", max: "100", step: "any" },
      { key: "commercial_peak_load_mj_per_day", label: "Zone-specific ComPeakLoad", type: "decimal", unit: "MJ/day", help: "Populate the exact approved Commercial Peak Load for the selected climate zone. RefElec is governed as 365 x 0.905 x 1.05 x ComPeakLoad / 1000.", defaultValue: "42", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "hp_electricity_gj_per_year", label: "Zone-specific HPElec", type: "decimal", unit: "GJ/year", help: "Populate the exact approved annual heat-pump electrical energy for the selected climate zone.", defaultValue: "1", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "hp_gas_gj_per_year", label: "Zone-specific HPGas", type: "decimal", unit: "GJ/year", help: "Populate the exact approved annual heat-pump gas energy for the selected climate zone; use zero for systems with no gas energy.", defaultValue: "0", source: "approved_product", required: true, min: "0", step: "any" },
      { key: "refrigerant_gwp", label: "Refrigerant global warming potential", type: "decimal", unit: "GWP", help: "Populate the exact VEU product-guide refrigerant GWP; do not infer it from an ungoverned refrigerant-name mapping.", defaultValue: "675", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "refrigerant_charge_kg", label: "Refrigerant charge", type: "decimal", unit: "kg", help: "Populate the selected approved product's exact manufacturer-specified refrigerant charge.", defaultValue: "1", source: "approved_product", required: true, min: "0", minExclusive: true, step: "any" },
      { key: "delivery_temperature_c", label: "Minimum delivery temperature", type: "decimal", unit: "C", help: "Enter the governed installed-as-modelled delivery temperature. Part 44 requires at least 45 C.", defaultValue: "45", source: "operator", required: true, min: "45", step: "any" },
      { key: "warranty_years", label: "Product warranty", type: "decimal", unit: "years", help: "Enter the evidenced product warranty. Average storage volume up to and including 700 L requires at least five years.", defaultValue: "5", source: "operator", required: true, min: "0", step: "any" },
      { key: "as_nzs_2712_status", label: "AS/NZS 2712 certification", type: "select", unit: "status", help: "Average insulated storage volume up to and including 700 L requires accredited AS/NZS 2712 certification; select not applicable only when the calculated average exceeds 700 L.", defaultValue: "certified", source: "operator", required: true, options: [{ value: "certified", label: "Accredited AS/NZS 2712 certification evidenced" }, { value: "not_applicable_over_700_litres", label: "Not applicable, average storage exceeds 700 L" }] },
      { key: "incumbent_equipment_age_years", label: "Incumbent product age", type: "decimal", unit: "years", help: "Enter the evidenced age at decommissioning. Scenarios 44A(i) and 44A(ii) require at least 10 years.", defaultValue: "10", source: "operator", required: true, min: "10", step: "any", showWhen: { key: "scenario", oneOf: ["44A(i)", "44A(ii)"] }, omitWhenHidden: true },
      { key: "incumbent_decommissioning_evidence_confirmed", label: "Incumbent decommissioning evidence", type: "select", unit: "confirmation", help: "Confirm the incumbent product was in working order and the applicable decommissioning evidence is retained.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "scenario", oneOf: ["44A(i)", "44A(ii)"] }, omitWhenHidden: true },
      { key: "existing_storage_requirements_confirmed", label: "Existing-storage evidence", type: "select", unit: "confirmation", help: "Confirm the retained tank is insulated, was manufactured less than 10 years before decommissioning, and has at least the modelled component volume.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }], showWhen: { key: "storage_configuration", oneOf: ["existing_storage"] }, omitWhenHidden: true },
      { key: "installation_and_model_evidence_confirmed", label: "Installed-as-modelled and licensing evidence", type: "select", unit: "confirmation", help: "Confirm licensed or registered plumber installation, approved modelling outputs, and installed-as-modelled evidence are retained.", defaultValue: "yes", source: "operator", required: true, options: [{ value: "yes", label: "Confirmed with governed evidence" }] },
      { key: "co_payment_per_installed_product_aud", label: "Co-payment per installed product", type: "decimal", unit: "AUD including GST", help: "Part 44 requires a minimum co-payment of $10,000 including GST per installed product.", defaultValue: "10000", source: "operator", required: true, min: "10000", step: "any" },
      { key: "installation_count", label: "Identical modelled-system count", type: "decimal", unit: "systems", help: "Enter the number of installations sharing this exact approved model, guide output, incumbent capacity and site scenario. Calculate heterogeneous systems separately.", defaultValue: "1", source: "operator", required: true, min: "1", step: "1" },
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
      { key: "scenario", label: "Induction-cooking scenario", type: "select", unit: "scenario", help: "The selected VEU-approved product determines the applicable cooking-product type.", defaultValue: "46A", source: "approved_product", required: true, options: [{ value: "46A", label: "In-bench induction cooktop for a home with gas or LPG (46A)" }, { value: "46B", label: "Freestanding combined induction cooking product for a home with gas or LPG (46B)" }] },
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
      { key: "scenario", label: "Ceiling-insulation scenario", type: "select", unit: "scenario", help: "Choose whether the ceiling is uninsulated or under-insulated and the approved product category being installed.", defaultValue: "48A(i)", source: "operator", required: true, options: CEILING_INSULATION_SCENARIO_OPTIONS },
      { key: "geography", label: "Location", type: "select", unit: "location", help: "Resolve this from the installation postcode using the official metropolitan/regional classification.", defaultValue: "metropolitan", source: "postcode_lookup", required: true, options: METRO_REGIONAL_OPTIONS },
      { key: "climatic_region", label: "Climatic region", type: "select", unit: "region", help: "Resolve the official mild, cold or hot climatic region from the installation postcode.", defaultValue: "mild", source: "postcode_lookup", required: true, options: [{ value: "mild", label: "Mild" }, { value: "cold", label: "Cold" }, { value: "hot", label: "Hot" }] },
      { key: "area_m2", label: "Installed insulation area", type: "decimal", unit: "m2", help: "Enter the eligible ceiling area covered by the selected approved insulation product.", defaultValue: "100", source: "operator", required: true, min: "0", minExclusive: true, step: "any" },
    ],
  },
] as const satisfies readonly CreditexVeuActivityDefinition[];

export const CREDITEX_VEU_DEFERRED_ACTIVITIES = [
  { activityCode: "45", reason: "Closed on 23 June 2026; no current VEU claim is available." },
  { activityCode: "47", reason: "CEC module, inverter, DNSP and system-level evidence require a separate solar-system contract." },
  { activityCode: "PBA", reason: "Project-based activities use approved M&V or benchmark-rating projects, not a deemed dropdown formula." },
] as const;
