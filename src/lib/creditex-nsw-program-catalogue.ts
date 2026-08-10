export const CREDITEX_NSW_PROGRAM_CATALOGUE_REVIEWED_ON = "2026-08-11";

export type CreditexNswInputOption = {
  value: string;
  label: string;
};

export type CreditexNswInputDefinition = {
  key: string;
  label: string;
  type: "decimal" | "integer" | "select";
  unit: string;
  defaultValue: string;
  minimum?: string;
  maximum?: string;
  help: string;
  options?: readonly CreditexNswInputOption[];
};

export type CreditexNswSourceReference = {
  title: string;
  url: string;
  clauses: string;
  pages: string;
};

export type CreditexNswActivityDefinition = {
  activityCode: string;
  officialActivityCode: string;
  title: string;
  supportedScenario: string;
  formulaKey: string;
  effectiveFrom: string;
  effectiveTo: string;
  effectiveDateLabel?: "Installation date" | "Onboarding date";
  lifetimeYears: number;
  outputUnit: "ESC" | "PRC";
  calculationStatus: "estimate_available" | "official_registry_required";
  productKinds: readonly string[];
  inputDefinitions: readonly CreditexNswInputDefinition[];
  productRegistryRequirements: readonly string[];
  sourceReferences: readonly CreditexNswSourceReference[];
};

export type CreditexNswProgramDefinition = {
  programCode: "NSW-ESS-2026" | "NSW-PDRS-2026";
  name: string;
  outputUnit: "ESC" | "PRC";
  effectiveFrom: string;
  effectiveTo: string;
  sourceVersion: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  activities: readonly CreditexNswActivityDefinition[];
  operatorMessage: string;
};

export type CreditexNswBlockedActivity = {
  programCode: "NSW-ESS-2026" | "NSW-PDRS-2026";
  activityCode: string;
  status:
    | "not_commenced"
    | "suspended"
    | "expired"
    | "external_dataset_required"
    | "outside_bounded_slice";
  reason: string;
  officialSourceUrl: string;
  sourceClauses: string;
};

const ESS_RULE_URL =
  "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF";
const PDRS_RULE_URL =
  "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Peak-Demand-Reduction-Scheme-Rule-of-2022-1-July-2026.PDF";
const PRODUCT_LIST_URL =
  "https://www.energysustainabilityschemes.nsw.gov.au/product-lists";
const CEC_BATTERY_LIST_URL =
  "https://cleanenergycouncil.org.au/industry-programs/products-program/batteries";
const GEMS_DATA_URL =
  "https://www.energyrating.gov.au/about-us/gems-regulator/registered-appliance-and-equipment-data";
const ABCB_CLIMATE_URL = "https://www.abcb.gov.au/abcb-climate-map";
const ELECTRICITY_SUPPLY_ACT_URL =
  "https://legislation.nsw.gov.au/view/whole/html/inforce/current/act-1995-094";
const ELECTRICITY_SUPPLY_REGULATION_URL =
  "https://legislation.nsw.gov.au/view/whole/html/inforce/current/sl-2014-0523";

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const NETWORK_OPTIONS = [
  { value: "ausgrid", label: "Ausgrid" },
  { value: "endeavour", label: "Endeavour Energy" },
  { value: "essential", label: "Essential Energy" },
] as const;

const APPLICATION_OPTIONS = [
  { value: "new", label: "New installation" },
  { value: "replacement", label: "Replacement" },
] as const;

const AIRCON_COOLING_BASIS_OPTIONS = [
  { value: "tcspf", label: "TCSPF recorded in GEMS" },
  {
    value: "rated_aeer_no_tcspf",
    label: "Rated AEER (GEMS has no applicable TCSPF)",
  },
] as const;

const AIRCON_HEATING_BASIS_OPTIONS = [
  { value: "hspf", label: "Applicable HSPF recorded in GEMS" },
  {
    value: "rated_acop_no_hspf",
    label: "Rated ACOP (GEMS has no applicable HSPF)",
  },
] as const;

const SYSTEM_SIZE_OPTIONS = [
  { value: "small", label: "Small thermal peak load" },
  { value: "medium", label: "Medium thermal peak load" },
] as const;

const BCA_ZONE_OPTIONS = ["2", "3", "4", "5", "6", "7", "8"].map((value) => ({
  value,
  label: `BCA climate zone ${value}`,
}));

const HEER_PAYMENT_EXEMPTION_OPTIONS = [
  { value: "none", label: "No exemption" },
  { value: "low_income", label: "Low-income Energy Program" },
  { value: "exempt_energy", label: "Exempt Energy Program" },
] as const;

const IHEAB_PAYMENT_EXEMPTION_OPTIONS = [
  { value: "none", label: "No exemption" },
  { value: "exempt_energy", label: "Exempt Energy Program" },
] as const;

function selectInput(
  key: string,
  label: string,
  defaultValue: string,
  options: readonly CreditexNswInputOption[],
  help: string,
): CreditexNswInputDefinition {
  return { key, label, type: "select", unit: "selection", defaultValue, options, help };
}

function decimalInput(
  key: string,
  label: string,
  unit: string,
  defaultValue: string,
  minimum: string,
  maximum: string,
  help: string,
): CreditexNswInputDefinition {
  return {
    key,
    label,
    type: "decimal",
    unit,
    defaultValue,
    minimum,
    maximum,
    help,
  };
}

function integerInput(
  key: string,
  label: string,
  unit: string,
  defaultValue: string,
  minimum: string,
  maximum: string,
  help: string,
): CreditexNswInputDefinition {
  return {
    key,
    label,
    type: "integer",
    unit,
    defaultValue,
    minimum,
    maximum,
    help,
  };
}

const NSW_SITE_CONFIRMATION = selectInput(
  "nsw_site_confirmed",
  "Eligible NSW site confirmed",
  "yes",
  YES_NO_OPTIONS,
  "The estimator does not infer scheme jurisdiction from a postcode or network name.",
);

const RULE_REQUIREMENTS_CONFIRMATION = selectInput(
  "all_non_formula_requirements_confirmed",
  "All non-formula rule requirements confirmed",
  "yes",
  YES_NO_OPTIONS,
  "Confirm site, purchaser, installation, evidence, disposal, warranty, licence and other rule requirements outside the arithmetic.",
);

const REGISTRY_CONFIRMATION = selectInput(
  "product_registry_eligibility_confirmed",
  "Current product-list eligibility confirmed",
  "yes",
  YES_NO_OPTIONS,
  "Confirm the exact model remains eligible in the current administrator-approved list or referenced GEMS register on the implementation date.",
);

const NETWORK_INPUT = selectInput(
  "distribution_network",
  "Distribution network",
  "ausgrid",
  NETWORK_OPTIONS,
  "PDRS Table A3 is network-based. A postcode is not a safe substitute for the actual connected distribution network.",
);

const POSTCODE_INPUT = integerInput(
  "site_postcode",
  "Physical installation postcode",
  "postcode",
  "2000",
  "1000",
  "9999",
  "Use the physical site postcode, not a PO box. ESS Table A24 determines the regional network factor and Table A27 determines air-conditioner climate.",
);

const NOMINAL_BATTERY_INPUT = decimalInput(
  "nominal_battery_capacity_kwh",
  "Nominal battery capacity",
  "kWh",
  "10",
  "0.000000001",
  "1000000",
  "Use the nominal capacity recorded for the exact product. The Rule defines usable capacity as 90% of nominal capacity.",
);

const INVERTER_OUTPUT_INPUT = decimalInput(
  "battery_inverter_output_kw",
  "Battery inverter output",
  "kW",
  "5",
  "0.000000001",
  "1000000",
  "Use the exact Rule-defined Battery Inverter Output from the applicable official evidence. The CEC Battery Listing API RatedDCPower field is not treated as this value. BESS5 requires the administrator-specified recording manner.",
);

const PDRS_COMMON_INPUTS = [
  NETWORK_INPUT,
  NSW_SITE_CONFIRMATION,
  REGISTRY_CONFIRMATION,
  RULE_REQUIREMENTS_CONFIRMATION,
] as const;

const ESS_COMMON_INPUTS = [POSTCODE_INPUT, NSW_SITE_CONFIRMATION, REGISTRY_CONFIRMATION, RULE_REQUIREMENTS_CONFIRMATION] as const;

const PDRS_GENERAL_SOURCE: CreditexNswSourceReference = {
  title: "Peak Demand Reduction Scheme Rule of 2022, effective 1 July 2026",
  url: PDRS_RULE_URL,
  clauses: "1; 6.2-6.4; 6.8; Equations 1, 2a, 2b and 2c; Tables A3-A6",
  pages: "3, 6, 8, 10-15, 26",
};

const ESS_GENERAL_SOURCE: CreditexNswSourceReference = {
  title: "Energy Savings Scheme Rule of 2009, effective 1 July 2026",
  url: ESS_RULE_URL,
  clauses: "1.1; 6.5 Equation 1; Table A24; Tables A26-A27",
  pages: "3, 9, 103-106",
};

const PRODUCT_SOURCE: CreditexNswSourceReference = {
  title: "NSW Energy Security Safeguard product lists",
  url: PRODUCT_LIST_URL,
  clauses: "Current product-list routing",
  pages: "web registry",
};

const CEC_BATTERY_SOURCE: CreditexNswSourceReference = {
  title: "Clean Energy Council Approved Batteries list",
  url: CEC_BATTERY_LIST_URL,
  clauses: "Current and installation-date approved battery model",
  pages: "web registry",
};

const GEMS_SOURCE: CreditexNswSourceReference = {
  title: "GEMS registered appliance and equipment data",
  url: GEMS_DATA_URL,
  clauses: "Current registered product data",
  pages: "web register",
};

const ABCB_SOURCE: CreditexNswSourceReference = {
  title: "ABCB Climate Map",
  url: ABCB_CLIMATE_URL,
  clauses: "Current BCA climate zone for Table A26",
  pages: "interactive map",
};

const ESS_ELECTRICITY_CONVERSION_SOURCE: CreditexNswSourceReference = {
  title: "Electricity Supply Act 1995",
  url: ELECTRICITY_SUPPLY_ACT_URL,
  clauses: "Schedule 4A clause 33(1), current electricity certificate conversion factor 1.06",
  pages: "current legislation",
};

const ESS_OTHER_FUEL_CONVERSION_SOURCE: CreditexNswSourceReference = {
  title: "Electricity Supply (General) Regulation 2014",
  url: ELECTRICITY_SUPPLY_REGULATION_URL,
  clauses: "Clause 37A, current gas and other-fuel certificate conversion factors",
  pages: "current legislation",
};

function productKindsFor(officialActivityCode: string) {
  if (["BESS1", "BESS2", "BESS3", "BESS4"].includes(officialActivityCode)) {
    return ["cec_battery"];
  }
  if (officialActivityCode === "BESS5") {
    return ["administrator_recorded_bess5_system"];
  }
  if (officialActivityCode === "HVAC1" || officialActivityCode === "HVAC2" || officialActivityCode === "D16" || officialActivityCode === "F4") {
    return ["air_conditioner"];
  }
  if (officialActivityCode === "RF2") return ["refrigerated_cabinet"];
  if (officialActivityCode === "SYS2" || officialActivityCode === "D5") return ["pool_pump"];
  if (officialActivityCode === "D17" || officialActivityCode === "D19") return ["heat_pump_water_heater"];
  if (officialActivityCode === "D18" || officialActivityCode === "D20") return ["solar_water_heater"];
  return [];
}

function calculationStatusFor(officialActivityCode: string) {
  return officialActivityCode.startsWith("BESS")
    || ["D17", "D18", "D19", "D20"].includes(officialActivityCode)
    ? "official_registry_required" as const
    : "estimate_available" as const;
}

function pdrsActivity(
  value: Omit<CreditexNswActivityDefinition, "outputUnit" | "effectiveTo" | "calculationStatus" | "productKinds">,
): CreditexNswActivityDefinition {
  return {
    ...value,
    outputUnit: "PRC",
    effectiveTo: "2026-12-31",
    calculationStatus: calculationStatusFor(value.officialActivityCode),
    productKinds: productKindsFor(value.officialActivityCode),
  };
}

function essActivity(
  value: Omit<CreditexNswActivityDefinition, "outputUnit" | "effectiveTo" | "calculationStatus" | "productKinds">,
): CreditexNswActivityDefinition {
  return {
    ...value,
    outputUnit: "ESC",
    effectiveTo: "2026-12-31",
    calculationStatus: calculationStatusFor(value.officialActivityCode),
    productKinds: productKindsFor(value.officialActivityCode),
    sourceReferences: [
      ...value.sourceReferences,
      ESS_ELECTRICITY_CONVERSION_SOURCE,
      ESS_OTHER_FUEL_CONVERSION_SOURCE,
    ],
  };
}

const PDRS_BATTERY_ACTIVITIES: readonly CreditexNswActivityDefinition[] = [
  pdrsActivity({
    activityCode: "BESS1",
    officialActivityCode: "BESS1",
    title: "Install a new behind-the-meter battery at an eligible government or exempt-program site",
    supportedScenario: "One exact CEC-approved battery whose installation-date nominal capacity and all Rule eligibility evidence are confirmed",
    formulaKey: "nsw-pdrs-bess1-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 15,
    inputDefinitions: [
      NOMINAL_BATTERY_INPUT,
      selectInput(
        "post_2025_exception",
        "BESS1 post-30 June 2025 exception",
        "government_site",
        [
          { value: "government_site", label: "Government owned and managed site" },
          { value: "exempt_energy_program", label: "Exempt Energy Program" },
          { value: "both", label: "Both exceptions apply" },
          { value: "none", label: "No exception" },
        ],
        "Clause 6.10 blocks post-30 June 2025 BESS1 unless at least one listed exception applies.",
      ),
      decimalInput(
        "net_payment_ex_gst_aud",
        "Purchaser net payment per item",
        "AUD",
        "200",
        "0",
        "100000000",
        "Clause 8.1.1 requires at least $200 per item unless a permitted program exemption applies.",
      ),
      selectInput(
        "payment_exemption",
        "Payment exemption",
        "none",
        HEER_PAYMENT_EXEMPTION_OPTIONS,
        "Choose an exemption only where the implementation is delivered through that program on the implementation date.",
      ),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: [
      "Exact model on the CEC Approved Batteries list for the implementation date",
      "Administrator-approved installer list",
      "Current banned equipment, VPP and demand-response-aggregator notices",
    ],
    sourceReferences: [
      PDRS_GENERAL_SOURCE,
      {
        title: "PDRS BESS1 provisions",
        url: PDRS_RULE_URL,
        clauses: "6.10; 8.1.1-8.1.6; BESS1.1-BESS1.2",
        pages: "9, 11-12, 36",
      },
      PRODUCT_SOURCE,
      CEC_BATTERY_SOURCE,
    ],
  }),
  pdrsActivity({
    activityCode: "BESS2",
    officialActivityCode: "BESS2",
    title: "Onboard an existing behind-the-meter battery with a demand response aggregator",
    supportedScenario: "One existing exact CEC-approved battery with onboarding-date product-list status, nominal capacity and a confirmed 12-month demand-response contract",
    formulaKey: "nsw-pdrs-bess2-2026-07/v1",
    effectiveFrom: "2026-07-01",
    effectiveDateLabel: "Onboarding date",
    lifetimeYears: 6,
    inputDefinitions: [NOMINAL_BATTERY_INPUT, ...PDRS_COMMON_INPUTS],
    productRegistryRequirements: [
      "Exact model on the CEC Approved Batteries list for the onboarding date (the BESS2 Implementation Date)",
      "Current banned equipment, VPP and demand-response-aggregator notices",
    ],
    sourceReferences: [
      PDRS_GENERAL_SOURCE,
      {
        title: "PDRS BESS2 provisions",
        url: PDRS_RULE_URL,
        clauses: "9.1.1-9.1.4; BESS2.1-BESS2.2",
        pages: "15-16, 41",
      },
      PRODUCT_SOURCE,
      CEC_BATTERY_SOURCE,
    ],
  }),
  pdrsActivity({
    activityCode: "BESS3",
    officialActivityCode: "BESS3",
    title: "Install a new behind-the-meter apartment battery",
    supportedScenario: "One outdoor apartment BESS for at least four dwellings with an exact CEC-approved battery and independently governed Battery Inverter Output",
    formulaKey: "nsw-pdrs-bess3-2026-09/v1",
    effectiveFrom: "2026-09-01",
    lifetimeYears: 15,
    inputDefinitions: [
      { ...NOMINAL_BATTERY_INPUT, defaultValue: "40" },
      { ...INVERTER_OUTPUT_INPUT, defaultValue: "10" },
      integerInput(
        "individual_dwellings",
        "Individual dwellings",
        "dwelling",
        "8",
        "4",
        "100000",
        "BESS3 battery capacity is capped at 5 kWh per individual dwelling.",
      ),
      selectInput(
        "solar_pathway",
        "Solar installation pathway",
        "within_90_days_no_nsw_funding",
        [
          {
            value: "within_90_days_no_nsw_funding",
            label: "New solar within 90 days; no NSW Government funding",
          },
          { value: "other", label: "All other cases" },
        ],
        "The 0.12 coefficient applies only to new solar within 90 days where NSW Government funding was not received for that solar.",
      ),
      decimalInput(
        "net_payment_ex_gst_aud",
        "Purchaser net payment per item",
        "AUD",
        "1000",
        "0",
        "100000000",
        "Clause 8.1.7 requires at least $1,000 per item unless a permitted program exemption applies.",
      ),
      selectInput(
        "payment_exemption",
        "Payment exemption",
        "none",
        HEER_PAYMENT_EXEMPTION_OPTIONS,
        "Choose an exemption only where the implementation is delivered through that program on the implementation date.",
      ),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: [
      "Exact model on the CEC Approved Batteries list for the implementation date",
      "Exact Rule-defined Battery Inverter Output from an official field; CEC RatedDCPower is not substituted",
      "Administrator-approved installer list",
      "Current banned equipment, VPP and demand-response-aggregator notices",
    ],
    sourceReferences: [
      PDRS_GENERAL_SOURCE,
      {
        title: "PDRS BESS3 provisions",
        url: PDRS_RULE_URL,
        clauses: "1.1; 8.1.7-8.1.12; BESS3.1-BESS3.3",
        pages: "3, 12-13, 37",
      },
      PRODUCT_SOURCE,
      CEC_BATTERY_SOURCE,
    ],
  }),
  pdrsActivity({
    activityCode: "BESS4",
    officialActivityCode: "BESS4",
    title: "Install a small or medium business behind-the-meter battery",
    supportedScenario: "One non-residential, non-data-centre BESS with an exact CEC-approved battery, governed Battery Inverter Output, installer and solar-capacity data",
    formulaKey: "nsw-pdrs-bess4-2026-09/v1",
    effectiveFrom: "2026-09-01",
    lifetimeYears: 15,
    inputDefinitions: [
      { ...NOMINAL_BATTERY_INPUT, defaultValue: "40" },
      { ...INVERTER_OUTPUT_INPUT, defaultValue: "10" },
      decimalInput(
        "new_solar_capacity_kw",
        "New solar photovoltaic capacity",
        "kW",
        "10",
        "0",
        "1000000",
        "BESS4 requires new solar capacity of at least one quarter of usable battery capacity.",
      ),
      selectInput(
        "new_solar_within_90_days",
        "BESS installed within 90 days of new solar",
        "yes",
        YES_NO_OPTIONS,
        "This selects the BESS4.2 or BESS4.3 coefficient path.",
      ),
      decimalInput(
        "net_payment_ex_gst_aud",
        "Purchaser net payment per item",
        "AUD",
        "5000",
        "0",
        "100000000",
        "Clause 8.1.13 requires at least $5,000 per item and provides no payment-program exception.",
      ),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: [
      "Exact model on the CEC Approved Batteries list for the implementation date",
      "Exact Rule-defined Battery Inverter Output from an official field; CEC RatedDCPower is not substituted",
      "Administrator-approved installer list",
      "Current banned equipment, VPP and demand-response-aggregator notices",
    ],
    sourceReferences: [
      PDRS_GENERAL_SOURCE,
      {
        title: "PDRS BESS4 provisions",
        url: PDRS_RULE_URL,
        clauses: "1.1; 8.1.13-8.1.17; BESS4.1-BESS4.3C",
        pages: "3, 13-14, 38-39",
      },
      PRODUCT_SOURCE,
      CEC_BATTERY_SOURCE,
    ],
  }),
  pdrsActivity({
    activityCode: "BESS5",
    officialActivityCode: "BESS5",
    title: "Install a commercial or industrial behind-the-meter energy storage system",
    supportedScenario: "One non-residential, non-data-centre system whose capacity and inverter values are recorded in the current administrator-specified manner",
    formulaKey: "nsw-pdrs-bess5-2026-09/v1",
    effectiveFrom: "2026-09-01",
    lifetimeYears: 15,
    inputDefinitions: [
      { ...NOMINAL_BATTERY_INPUT, defaultValue: "300" },
      { ...INVERTER_OUTPUT_INPUT, defaultValue: "50" },
      decimalInput(
        "new_solar_capacity_kw",
        "New solar photovoltaic capacity",
        "kW",
        "100",
        "0",
        "10000000",
        "BESS5 requires new solar capacity of at least one quarter of usable battery capacity.",
      ),
      selectInput(
        "new_solar_within_90_days",
        "BESS installed within 90 days of new solar",
        "yes",
        YES_NO_OPTIONS,
        "This selects the BESS5.2 or BESS5.3 coefficient path.",
      ),
      selectInput(
        "administrator_recording_confirmed",
        "Administrator-specified recording confirmed",
        "yes",
        YES_NO_OPTIONS,
        "The Rule does not itself prescribe the BESS5 recording format. Calculation fails unless the ACP confirms the current administrator-specified manner was used.",
      ),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: [
      "Distinct BESS5 capacity and inverter evidence recorded in the current Scheme Administrator-specified manner",
      "Current banned equipment, VPP and demand-response-aggregator notices",
    ],
    sourceReferences: [
      PDRS_GENERAL_SOURCE,
      {
        title: "PDRS BESS5 provisions",
        url: PDRS_RULE_URL,
        clauses: "1.1; 8.1.18-8.1.21; BESS5.1-BESS5.3",
        pages: "3, 14-15, 40",
      },
      PRODUCT_SOURCE,
    ],
  }),
];

function airconProductClassInput(
  values: readonly number[],
  defaultValue: string,
): CreditexNswInputDefinition {
  return selectInput(
    "product_class",
    "GEMS product class",
    defaultValue,
    values.map((value) => ({ value: String(value), label: `Class ${value}` })),
    "Use the exact GEMS product class for the installed outdoor unit.",
  );
}

const PDRS_HVAC_COMMON_INPUTS = [
  selectInput(
    "application_type",
    "Application type",
    "new",
    APPLICATION_OPTIONS,
    "The baseline AEER table distinguishes new installations from replacements.",
  ),
  selectInput(
    "cooling_efficiency_basis",
    "Cooling eligibility metric",
    "tcspf",
    AIRCON_COOLING_BASIS_OPTIONS,
    "Rated AEER may be used only where the applicable TCSPF is not recorded in GEMS.",
  ),
  decimalInput(
    "cooling_efficiency_value",
    "Cooling eligibility value",
    "ratio",
    "6",
    "0.000000001",
    "100",
    "Enter the applicable TCSPF or permitted fallback rated AEER from GEMS.",
  ),
  selectInput(
    "bca_climate_zone",
    "BCA climate zone",
    "4",
    BCA_ZONE_OPTIONS.filter((option) => option.value !== "3"),
    "PDRS Table A5 contains factors for zones 2, 4, 5, 6, 7 and 8. Zone 3 has no factor and is rejected.",
  ),
] as const;

function pdrsHvacInputs(
  productClasses: readonly number[],
  multi: boolean,
  commercial = false,
): readonly CreditexNswInputDefinition[] {
  return [
    airconProductClassInput(productClasses, multi ? "18" : "8"),
    ...PDRS_HVAC_COMMON_INPUTS.map((definition) => (
      definition.key === "cooling_efficiency_value" && commercial
        ? { ...definition, defaultValue: "7" }
        : definition
    )),
    ...(multi
      ? [
          decimalInput(
            "outdoor_cooling_capacity_kw",
            "Outdoor-unit cooling capacity at 35 C",
            "kW",
            "35",
            "0.000000001",
            "100000",
            "Use the GEMS outdoor-unit cooling capacity.",
          ),
          decimalInput(
            "indoor_cooling_capacity_sum_kw",
            "Sum of connected indoor cooling capacities at 35 C",
            "kW",
            "32",
            "0.000000001",
            "100000",
            "Use manufacturer documentation for the connected indoor units.",
          ),
          decimalInput(
            "outdoor_rated_cooling_input_kw",
            "Outdoor-unit rated cooling input at 35 C",
            "kW",
            "7",
            "0.000000001",
            "100000",
            "Use the rated input power recorded in GEMS for the outdoor unit.",
          ),
        ]
      : [
          decimalInput(
            "rated_cooling_capacity_kw",
            "Rated cooling capacity at 35 C",
            "kW",
            commercial ? "35" : "8",
            "0.000000001",
            "100000",
            "Use the value recorded in GEMS.",
          ),
          decimalInput(
            "rated_cooling_input_kw",
            "Rated cooling input power at 35 C",
            "kW",
            commercial ? "7" : "1.2",
            "0.000000001",
            "100000",
            "Use the value recorded in GEMS.",
          ),
        ]),
    ...PDRS_COMMON_INPUTS,
  ];
}

const PDRS_EFFICIENCY_ACTIVITIES: readonly CreditexNswActivityDefinition[] = [
  pdrsActivity({
    activityCode: "HVAC1-SINGLE",
    officialActivityCode: "HVAC1",
    title: "Residential or small-business high-efficiency air conditioner",
    supportedScenario: "One non-multi GEMS product with current product metrics",
    formulaKey: "nsw-pdrs-hvac1-single-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: pdrsHvacInputs([5, 6, 7, 8, 9, 10, 11, 12], false),
    productRegistryRequirements: ["GEMS air-conditioner registration and current NSW product restrictions"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS HVAC1",
      url: PDRS_RULE_URL,
      clauses: "7.1.1-7.1.3; HVAC1.1-HVAC1.2; Tables HVAC1.1-HVAC1.2",
      pages: "10, 27-28",
    }, GEMS_SOURCE],
  }),
  pdrsActivity({
    activityCode: "HVAC1-MULTI",
    officialActivityCode: "HVAC1",
    title: "Residential or small-business high-efficiency multi-split air conditioner",
    supportedScenario: "One multi-split GEMS outdoor unit with the connected indoor-unit capacity sum",
    formulaKey: "nsw-pdrs-hvac1-multi-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: pdrsHvacInputs([18, 19, 20, 21], true),
    productRegistryRequirements: ["GEMS outdoor-unit registration, manufacturer indoor-unit data and current NSW product restrictions"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS HVAC1 multi-split formula and cap",
      url: PDRS_RULE_URL,
      clauses: "7.1.1(f); HVAC1.1-HVAC1.2; Tables HVAC1.1-HVAC1.2",
      pages: "10, 27-28",
    }, GEMS_SOURCE],
  }),
  pdrsActivity({
    activityCode: "HVAC2-SINGLE",
    officialActivityCode: "HVAC2",
    title: "Business high-efficiency air conditioner",
    supportedScenario: "One non-multi GEMS product with at least 30 kW rated cooling capacity",
    formulaKey: "nsw-pdrs-hvac2-single-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: pdrsHvacInputs([5, 6, 7, 8, 9, 10, 11, 12, 24, 25], false, true),
    productRegistryRequirements: ["GEMS air-conditioner registration and current NSW product restrictions"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS HVAC2",
      url: PDRS_RULE_URL,
      clauses: "7.1.4-7.1.6; HVAC2.1-HVAC2.2; Tables HVAC2.1-HVAC2.2",
      pages: "10-11, 29-31",
    }, GEMS_SOURCE],
  }),
  pdrsActivity({
    activityCode: "HVAC2-MULTI",
    officialActivityCode: "HVAC2",
    title: "Business high-efficiency multi-split air conditioner",
    supportedScenario: "One multi-split system with at least 30 kW calculated cooling capacity",
    formulaKey: "nsw-pdrs-hvac2-multi-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: pdrsHvacInputs([18, 19, 20, 21, 27], true, true),
    productRegistryRequirements: ["GEMS outdoor-unit registration, manufacturer indoor-unit data and current NSW product restrictions"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS HVAC2 multi-split formula",
      url: PDRS_RULE_URL,
      clauses: "7.1.4-7.1.6; HVAC2.1-HVAC2.2; Tables HVAC2.1-HVAC2.2",
      pages: "10-11, 29-31",
    }, GEMS_SOURCE],
  }),
  pdrsActivity({
    activityCode: "RF2-REMOTE",
    officialActivityCode: "RF2",
    title: "Replace a remote refrigerated display cabinet",
    supportedScenario: "One active Class 12-15 remote refrigerated display cabinet; suspended Classes 1-11 are not executable",
    formulaKey: "nsw-pdrs-rf2-remote-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: [
      selectInput(
        "product_class",
        "Refrigerated cabinet product class",
        "12",
        [12, 13, 14, 15].map((value) => ({ value: String(value), label: `Class ${value}` })),
        "Only remote Classes 12-15 are executable while post-12 September 2025 Classes 1-11 remain suspended.",
      ),
      decimalInput("tec_kwh_per_24h", "Total energy consumption", "kWh/24h", "10", "0.000000001", "1000000", "Use TEC recorded in GEMS."),
      decimalInput("product_eei", "Product EEI", "index", "60", "0.000000001", "1000000", "Use the product EEI recorded in GEMS."),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: ["GEMS refrigerated-cabinet registration and current NSW product restrictions"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS RF2",
      url: PDRS_RULE_URL,
      clauses: "6.9.2; RF2.1-RF2.3; Tables RF2.1-RF2.3",
      pages: "9, 31-34",
    }, GEMS_SOURCE],
  }),
  pdrsActivity({
    activityCode: "SYS2",
    officialActivityCode: "SYS2",
    title: "Install or replace a high-efficiency pool pump",
    supportedScenario: "One GEMS pool pump with recorded PAEC, daily run time and maximum tested input",
    formulaKey: "nsw-pdrs-sys2-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 10,
    inputDefinitions: [
      decimalInput("maximum_tested_input_w", "Maximum tested input", "W", "900", "0.000000001", "1000000", "Use the GEMS High value."),
      decimalInput("paec_kwh_per_year", "Projected annual energy consumption", "kWh/year", "700", "0", "1000000000", "Use GEMS labelled energy consumption."),
      decimalInput("daily_run_time_hours", "Daily run time", "hours/day", "8", "0.000000001", "24", "Use the GEMS daily run time."),
      decimalInput("manufacturer_warranty_years", "Documented manufacturer warranty", "years", "3", "3", "100", "Enter the exact written product warranty. SYS2 requires at least 3 years; retain the manufacturer evidence with the implementation."),
      ...PDRS_COMMON_INPUTS,
    ],
    productRegistryRequirements: ["GEMS pool-pump registration, at least 4 stars and at least 3-year warranty"],
    sourceReferences: [PDRS_GENERAL_SOURCE, {
      title: "PDRS SYS2",
      url: PDRS_RULE_URL,
      clauses: "SYS2.1; Table SYS2.1; Table A4",
      pages: "26, 35",
    }, GEMS_SOURCE],
  }),
];

function essAirconInputs(
  productClasses: readonly number[],
  multi: boolean,
  commercial: boolean,
): readonly CreditexNswInputDefinition[] {
  return [
    airconProductClassInput(productClasses, multi ? "18" : "8"),
    ...(!multi
      ? [selectInput(
          "installation_configuration",
          "Installation configuration",
          "non_ducted",
          [
            { value: "non_ducted", label: "Non-ducted single or unitary system" },
            { value: "ducted", label: "Ducted system" },
          ],
          "D16 and F4 purchaser-payment requirements distinguish ducted systems. Choose the physical installed configuration.",
        )]
      : []),
    selectInput("application_type", "Application type", "new", APPLICATION_OPTIONS, "The baseline table distinguishes new installations and replacements."),
    selectInput("cooling_efficiency_basis", "Cooling eligibility metric", "tcspf", AIRCON_COOLING_BASIS_OPTIONS, "Rated AEER is permitted only when the applicable TCSPF is not recorded in GEMS."),
    decimalInput("cooling_efficiency_value", "Cooling eligibility value", "ratio", commercial ? "7" : "5.5", "0.000000001", "100", "Enter the applicable seasonal or permitted fallback value from GEMS."),
    selectInput("heating_efficiency_basis", "Heating eligibility metric", "hspf", AIRCON_HEATING_BASIS_OPTIONS, "Rated ACOP is permitted only when the applicable HSPF is not recorded in GEMS."),
    decimalInput("heating_efficiency_value", "Heating eligibility value", "ratio", "4.5", "0.000000001", "100", "Enter HSPF for the postcode climate or the permitted fallback rated ACOP."),
    ...(multi
      ? [
          decimalInput("outdoor_cooling_capacity_kw", "Outdoor-unit cooling capacity at 35 C", "kW", commercial ? "35" : "12", "0.000000001", "100000", "Use the GEMS outdoor-unit capacity."),
          decimalInput("indoor_cooling_capacity_sum_kw", "Sum of connected indoor cooling capacities at 35 C", "kW", commercial ? "32" : "10", "0.000000001", "100000", "Use manufacturer data for the connected indoor units."),
          decimalInput("outdoor_heating_capacity_kw", "Outdoor-unit heating capacity at 7 C", "kW", commercial ? "38" : "13", "0.000000001", "100000", "Use the GEMS outdoor-unit capacity."),
          decimalInput("indoor_heating_capacity_sum_kw", "Sum of connected indoor heating capacities at 7 C", "kW", commercial ? "34" : "11", "0.000000001", "100000", "Use manufacturer data for the connected indoor units."),
        ]
      : [
          decimalInput("cooling_capacity_kw", "Cooling capacity at 35 C", "kW", commercial ? "35" : "8", "0.000000001", "100000", "Use the GEMS value."),
          decimalInput("heating_capacity_kw", "Heating capacity at 7 C", "kW", commercial ? "38" : "9", "0.000000001", "100000", "Use the GEMS value."),
        ]),
    decimalInput("cooling_annual_energy_kwh", "Recorded cooling annual energy use", "kWh/year", commercial ? "4500" : "500", "0", "1000000000", "Use the applicable Commercial or Residential tcec/ZERL value. This bounded slice does not execute the rated-efficiency fallback annual-energy equations."),
    decimalInput("heating_annual_energy_kwh", "Recorded heating annual energy use", "kWh/year", commercial ? "2500" : "800", "0", "1000000000", "Use the applicable Commercial or Residential thec/ZERL value."),
    decimalInput("net_payment_ex_gst_aud", "Purchaser net payment", "AUD", commercial ? (multi ? "3000" : "1000") : (multi ? "1000" : "500"), "0", "100000000", "Enter the non-reimbursed net amount paid for the implementation or item."),
    selectInput("payment_exemption", "Payment exemption", "none", commercial ? IHEAB_PAYMENT_EXEMPTION_OPTIONS : HEER_PAYMENT_EXEMPTION_OPTIONS, "Choose an exemption only where the implementation is delivered through the relevant program."),
    ...ESS_COMMON_INPUTS,
  ];
}

function hpwhInputs(
  paymentDefault: string,
  includeBcaZone: boolean,
): readonly CreditexNswInputDefinition[] {
  return [
    selectInput("system_size", "AS/NZS 4234 system size", "small", SYSTEM_SIZE_OPTIONS, "Use the small or medium thermal peak load size accepted by the Scheme Administrator."),
    ...(includeBcaZone
      ? [selectInput("bca_climate_zone", "BCA climate zone", "5", BCA_ZONE_OPTIONS, "Resolve the physical site using the current ABCB Climate Map; Table A26 maps BCA zones 2-6 to HP3-AU and zones 7-8 to HP5-AU.")]
      : []),
    decimalInput("annual_supplementary_energy_gj", "Annual supplementary energy (Bs)", "GJ", "1", "0", "1000000", "Use the value determined under AS/NZS 4234 and accepted by the Scheme Administrator."),
    decimalInput("annual_auxiliary_electricity_gj", "Annual auxiliary electrical energy (Be)", "GJ", "0.2", "0", "1000000", "Use the value determined under AS/NZS 4234 and accepted by the Scheme Administrator."),
    decimalInput("net_payment_ex_gst_aud", "Purchaser net payment per item", "AUD", paymentDefault, "0", "100000000", "D17-D20 require at least $200 per installed item unless a permitted program exemption applies."),
    selectInput("payment_exemption", "Payment exemption", "none", HEER_PAYMENT_EXEMPTION_OPTIONS, "Choose an exemption only where the implementation is delivered through that program."),
    ...ESS_COMMON_INPUTS,
  ];
}

const ESS_ACTIVITIES: readonly CreditexNswActivityDefinition[] = [
  essActivity({
    activityCode: "D5",
    officialActivityCode: "D5",
    title: "Install or replace a high-efficiency pool pump",
    supportedScenario: "One GEMS pool pump with current PAEC and maximum tested input data",
    formulaKey: "nsw-ess-d5-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 10,
    inputDefinitions: [
      decimalInput("maximum_tested_input_w", "Maximum tested input", "W", "900", "0.000000001", "1000000", "Use the GEMS High value."),
      decimalInput("paec_kwh_per_year", "Projected annual energy consumption", "kWh/year", "700", "0", "1000000000", "Use GEMS labelled energy consumption."),
      decimalInput("manufacturer_warranty_years", "Documented manufacturer warranty", "years", "3", "3", "100", "Enter the exact written product warranty. D5 requires at least 3 years; retain the manufacturer evidence with the implementation."),
      decimalInput("net_payment_ex_gst_aud", "Purchaser net payment per item", "AUD", "200", "0", "100000000", "D5 requires at least $200 per installed item unless a permitted program exemption applies."),
      selectInput("payment_exemption", "Payment exemption", "none", HEER_PAYMENT_EXEMPTION_OPTIONS, "Choose an exemption only where the implementation is delivered through that program."),
      ...ESS_COMMON_INPUTS,
    ],
    productRegistryRequirements: ["GEMS pool-pump registration, at least 4 stars and at least 3-year warranty"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D5",
      url: ESS_RULE_URL,
      clauses: "9.8; Activity D5; Table D5.1",
      pages: "63-65, 115-116",
    }, GEMS_SOURCE],
  }),
  essActivity({
    activityCode: "D16-SINGLE",
    officialActivityCode: "D16",
    title: "Residential or small-business high-efficiency air conditioner",
    supportedScenario: "One non-multi reverse-cycle GEMS product with recorded Residential tcec and thec/ZERL values",
    formulaKey: "nsw-ess-d16-single-recorded-energy-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: essAirconInputs([5, 6, 7, 8, 9, 10, 11, 12], false, false),
    productRegistryRequirements: ["GEMS registration, Residential tcec/thec or ZERL values, and current NSW product restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D16",
      url: ESS_RULE_URL,
      clauses: "9.8.7; D16.1-D16.3; Tables D16.1-D16.6",
      pages: "64-65, 131-134",
    }, GEMS_SOURCE],
  }),
  essActivity({
    activityCode: "D16-MULTI",
    officialActivityCode: "D16",
    title: "Residential or small-business high-efficiency multi-split air conditioner",
    supportedScenario: "One multi-split system with recorded Residential tcec/thec or ZERL values and connected indoor-unit capacity sums",
    formulaKey: "nsw-ess-d16-multi-recorded-energy-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: essAirconInputs([18, 19, 20, 21], true, false),
    productRegistryRequirements: ["GEMS outdoor-unit registration, Residential tcec/thec or ZERL values, manufacturer indoor-unit data and current NSW restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D16 multi-split formula and cap",
      url: ESS_RULE_URL,
      clauses: "9.8.7; D16.1-D16.3; Tables D16.1-D16.6",
      pages: "64-65, 131-134",
    }, GEMS_SOURCE],
  }),
  essActivity({
    activityCode: "D17",
    officialActivityCode: "D17",
    title: "Replace electric water heating with an air-source heat-pump water heater",
    supportedScenario: "One accepted small or medium AS/NZS 4234 product with administrator-accepted Bs and Be values",
    formulaKey: "nsw-ess-d17-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: hpwhInputs("200", true),
    productRegistryRequirements: ["TESSA accepted heat-pump water-heater product and current restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D17",
      url: ESS_RULE_URL,
      clauses: "Activity D17; Table D17.1; Table A26",
      pages: "104, 135-136",
    }, PRODUCT_SOURCE, ABCB_SOURCE],
  }),
  essActivity({
    activityCode: "D18",
    officialActivityCode: "D18",
    title: "Replace electric water heating with a solar electric-boosted water heater",
    supportedScenario: "One accepted small or medium AS/NZS 4234 solar-zone-3 product with administrator-accepted Bs and Be values",
    formulaKey: "nsw-ess-d18-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 15,
    inputDefinitions: hpwhInputs("200", false),
    productRegistryRequirements: ["TESSA accepted solar water-heater product and current restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D18",
      url: ESS_RULE_URL,
      clauses: "Activity D18; Table D18.1",
      pages: "136-137",
    }, PRODUCT_SOURCE],
  }),
  essActivity({
    activityCode: "D19",
    officialActivityCode: "D19",
    title: "Replace gas water heating with an air-source heat-pump water heater",
    supportedScenario: "One accepted small or medium AS/NZS 4234 product with administrator-accepted Bs and Be values",
    formulaKey: "nsw-ess-d19-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: hpwhInputs("200", true),
    productRegistryRequirements: ["TESSA accepted heat-pump water-heater product and current restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D19",
      url: ESS_RULE_URL,
      clauses: "Activity D19; Table D19.1; Table A26",
      pages: "104, 137-138",
    }, PRODUCT_SOURCE, ABCB_SOURCE],
  }),
  essActivity({
    activityCode: "D20",
    officialActivityCode: "D20",
    title: "Replace gas water heating with a solar electric-boosted water heater",
    supportedScenario: "One accepted small or medium AS/NZS 4234 solar-zone-3 product with administrator-accepted Bs and Be values",
    formulaKey: "nsw-ess-d20-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 15,
    inputDefinitions: hpwhInputs("200", false),
    productRegistryRequirements: ["TESSA accepted solar water-heater product and current restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity D20",
      url: ESS_RULE_URL,
      clauses: "Activity D20; Table D20.1",
      pages: "139-140",
    }, PRODUCT_SOURCE],
  }),
  essActivity({
    activityCode: "F4-SINGLE",
    officialActivityCode: "F4",
    title: "Business high-efficiency air conditioner",
    supportedScenario: "One non-multi reverse-cycle GEMS product with at least 30 kW capacity and recorded Commercial tcec/thec values",
    formulaKey: "nsw-ess-f4-single-recorded-energy-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: essAirconInputs([5, 6, 7, 8, 9, 10, 11, 12, 24, 25], false, true),
    productRegistryRequirements: ["GEMS registration, Commercial tcec/thec values and current NSW product restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity F4",
      url: ESS_RULE_URL,
      clauses: "9.9; F4.1-F4.3; Tables F4.1-F4.6",
      pages: "65-67, 166-169",
    }, GEMS_SOURCE],
  }),
  essActivity({
    activityCode: "F4-MULTI",
    officialActivityCode: "F4",
    title: "Business high-efficiency multi-split air conditioner",
    supportedScenario: "One multi-split system with at least 30 kW calculated cooling capacity and recorded Commercial tcec/thec values",
    formulaKey: "nsw-ess-f4-multi-recorded-energy-2026-07/v1",
    effectiveFrom: "2026-07-01",
    lifetimeYears: 12,
    inputDefinitions: essAirconInputs([18, 19, 20, 21, 27], true, true),
    productRegistryRequirements: ["GEMS outdoor-unit registration, Commercial tcec/thec values, manufacturer indoor-unit data and current NSW restrictions"],
    sourceReferences: [ESS_GENERAL_SOURCE, {
      title: "ESS Activity F4 multi-split formula",
      url: ESS_RULE_URL,
      clauses: "9.9; F4.1-F4.3; Tables F4.1-F4.6",
      pages: "65-67, 166-169",
    }, GEMS_SOURCE],
  }),
];

export const CREDITEX_NSW_PROGRAM_DEFINITIONS: readonly CreditexNswProgramDefinition[] = [
  {
    programCode: "NSW-PDRS-2026",
    name: "NSW Peak Demand Reduction Scheme",
    outputUnit: "PRC",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    sourceVersion: "Peak Demand Reduction Scheme Rule of 2022 effective 1 July 2026; implementation pin reviewed 11 August 2026",
    officialSourceUrl: PDRS_RULE_URL,
    officialSourceTitle: "Peak Demand Reduction Scheme Rule of 2022 - 1 July 2026",
    activities: [...PDRS_BATTERY_ACTIVITIES, ...PDRS_EFFICIENCY_ACTIVITIES],
    operatorMessage: "Estimate only. PRCs are floored for the submitted single implementation and apportioned by compliance-period ordinal. Product-list status, bans, ACP accreditation and evidence must be reconciled at the implementation date before any certificate action.",
  },
  {
    programCode: "NSW-ESS-2026",
    name: "NSW Energy Savings Scheme",
    outputUnit: "ESC",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    sourceVersion: "Energy Savings Scheme Rule of 2009 effective 1 July 2026; implementation pin reviewed 8 August 2026",
    officialSourceUrl: ESS_RULE_URL,
    officialSourceTitle: "Energy Savings Scheme Rule of 2009 - 1 July 2026",
    activities: ESS_ACTIVITIES,
    operatorMessage: "Estimate only. The arithmetic is source-pinned to the 1 July 2026 Rule and one implementation/item. Current product acceptance, bans, ACP accreditation, payment and evidence must be reconciled before any certificate action.",
  },
] as const;

export const CREDITEX_NSW_BLOCKED_ACTIVITIES: readonly CreditexNswBlockedActivity[] = [
  {
    programCode: "NSW-PDRS-2026",
    activityCode: "V2G1",
    status: "not_commenced",
    reason: "The Ministerial Gazette commencement date required by clause 1.2 has not been incorporated into the source pin.",
    officialSourceUrl: PDRS_RULE_URL,
    sourceClauses: "1.2; 9.1.5-9.1.8; V2G1",
  },
  {
    programCode: "NSW-PDRS-2026",
    activityCode: "RF2-CLASSES-1-11",
    status: "suspended",
    reason: "Implementations on or after 12 September 2025 remain suspended until a Ministerial Gazette notice.",
    officialSourceUrl: PDRS_RULE_URL,
    sourceClauses: "6.9.2",
  },
  {
    programCode: "NSW-ESS-2026",
    activityCode: "D6-D9",
    status: "not_commenced",
    reason: "The insulation activities require a Ministerial Gazette commencement notice under clause 1.1(a).",
    officialSourceUrl: ESS_RULE_URL,
    sourceClauses: "1.1(a); D6-D9",
  },
  {
    programCode: "NSW-ESS-2026",
    activityCode: "D11,D12,D21,F8,F9",
    status: "expired",
    reason: "The Rule expires these activities at the end of 30 June 2026.",
    officialSourceUrl: ESS_RULE_URL,
    sourceClauses: "9.8.6; 9.9.6",
  },
  {
    programCode: "NSW-ESS-2026",
    activityCode: "F16,F17",
    status: "external_dataset_required",
    reason: "The equations depend on Scheme Administrator-accepted heat-load modelling outputs and evidence not supplied by a public deterministic registry contract.",
    officialSourceUrl: ESS_RULE_URL,
    sourceClauses: "F16; F17",
  },
  {
    programCode: "NSW-ESS-2026",
    activityCode: "COMMERCIAL-LIGHTING",
    status: "expired",
    reason: "New Commercial Lighting implementations ended on 31 March 2026; historical calculations require the rule/tool version effective on the implementation date.",
    officialSourceUrl: ESS_RULE_URL,
    sourceClauses: "9.4 and transitional provisions",
  },
  {
    programCode: "NSW-ESS-2026",
    activityCode: "OTHER-CURRENT-ESS-METHODS",
    status: "outside_bounded_slice",
    reason: "PIA, PIA M&V, Metered Baseline, public lighting, motors, power-factor correction and remaining deemed activities require separate source-complete modules and are not approximated here.",
    officialSourceUrl: ESS_RULE_URL,
    sourceClauses: "7-9; Schedules C-F",
  },
] as const;

export function creditexNswProgramDefinition(programCode: string) {
  return CREDITEX_NSW_PROGRAM_DEFINITIONS.find((program) => program.programCode === programCode);
}

export function creditexNswActivityDefinition(
  programCode: string,
  activityCode: string,
) {
  return creditexNswProgramDefinition(programCode)?.activities.find((activity) => activity.activityCode === activityCode);
}
