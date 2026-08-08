export const CREDITEX_LOCAL_PROGRAM_CATALOGUE_REVIEWED_ON = "2026-08-08";

export type CreditexLocalInputOption = {
  value: string;
  label: string;
};

export type CreditexLocalInputDefinition = {
  key: string;
  label: string;
  type: "decimal" | "integer" | "select";
  unit: string;
  defaultValue: string;
  minimum?: string;
  maximum?: string;
  help: string;
  options?: readonly CreditexLocalInputOption[];
};

export type CreditexLocalActivityDefinition = {
  activityCode: string;
  title: string;
  scenario: string;
  formulaKey: string;
  inputDefinitions: readonly CreditexLocalInputDefinition[];
  productRegistryRequirements: readonly string[];
};

export type CreditexLocalProgramDefinition = {
  programCode: string;
  jurisdiction: "QLD" | "WA" | "TAS" | "NT";
  name: string;
  outputUnit: "AUD";
  outputLabel: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  sourceVersion: string;
  activities: readonly CreditexLocalActivityDefinition[];
  operatorMessage: string;
};

const COST_INPUT: CreditexLocalInputDefinition = {
  key: "eligible_cost_aud",
  label: "Eligible paid cost",
  type: "decimal",
  unit: "AUD",
  defaultValue: "5000",
  minimum: "0",
  maximum: "100000000",
  help: "Enter only costs accepted by the official program rules.",
};

const COST_EX_GST_INPUT: CreditexLocalInputDefinition = {
  ...COST_INPUT,
  key: "eligible_cost_ex_gst_aud",
  label: "Eligible cost excluding GST",
  help: "GST and ineligible project costs must be removed before calculation.",
};

const EXPORT_INPUT: CreditexLocalInputDefinition = {
  key: "eligible_export_kwh",
  label: "Eligible exported electricity",
  type: "decimal",
  unit: "kWh",
  defaultValue: "100",
  minimum: "0",
  maximum: "1000000000",
  help: "Use metered net exports accepted by the retailer for the selected period.",
};

const PEAK_EXPORT_INPUT: CreditexLocalInputDefinition = {
  key: "peak_export_kwh",
  label: "Peak exports (3 pm to 9 pm)",
  type: "decimal",
  unit: "kWh",
  defaultValue: "5",
  minimum: "0",
  maximum: "1000000000",
  help: "Use eligible metered exports within the retailer peak window.",
};

const OFF_PEAK_EXPORT_INPUT: CreditexLocalInputDefinition = {
  key: "off_peak_export_kwh",
  label: "Off-peak exports",
  type: "decimal",
  unit: "kWh",
  defaultValue: "15",
  minimum: "0",
  maximum: "1000000000",
  help: "Use eligible metered exports outside 3 pm to 9 pm.",
};

const DWELLING_INPUT: CreditexLocalInputDefinition = {
  key: "eligible_dwellings",
  label: "Eligible dwellings",
  type: "integer",
  unit: "dwelling",
  defaultValue: "2",
  minimum: "1",
  maximum: "100000",
  help: "Count only dwellings accepted by the program rules.",
};

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const QLD_SSR_ACTIVITY_ROWS = [
  ["PV-3-4", "Rooftop solar from 3 kW to less than 4 kW", "3 kW to under 4 kW system"],
  ["PV-4-5", "Rooftop solar from 4 kW to less than 5 kW", "4 kW to under 5 kW system"],
  ["PV-5-PLUS", "Rooftop solar at or above 5 kW", "5 kW or larger system"],
] as const;

const QLD_QCHEU_ACTIVITY_ROWS = [
  ["INSULATION", "Ceiling insulation"],
  ["DRAUGHT", "Draught proofing"],
  ["COOKTOP", "Electric cooktop"],
  ["OVEN", "Electric oven"],
  ["HPWH", "Heat-pump water heating"],
  ["SWH", "Solar water heating"],
  ["COMMON-HW", "Common water heating"],
  ["SHADING", "Window shading"],
  ["GLAZING", "High-performance glazing"],
  ["HVAC", "Split-system air conditioning"],
  ["PV", "Solar PV"],
  ["FANS", "DC fans as a supplementary measure"],
  ["LED", "LED lighting as a supplementary measure"],
] as const;

export const HORIZON_POWER_TOWN_CLASSES = {
  Ardyaloon: "C",
  "Beagle Bay": "C",
  Bidyadanga: "C",
  Broome: "A",
  "Camballin/Looma": "C",
  Carnarvon: "A",
  "Coral Bay": "B",
  Cue: "B",
  Denham: "B",
  Derby: "A",
  "Djarindjin/Lombadina": "C",
  Esperance: "A",
  Exmouth: "A",
  "Fitzroy Crossing": "A",
  "Gascoyne Junction": "C",
  "Halls Creek": "A",
  Hopetoun: "C",
  Kalumburu: "C",
  Karratha: "A",
  Kununurra: "A",
  "Lake Argyle": "A",
  Laverton: "C",
  Leonora: "B",
  "Marble Bar": "C",
  Meekatharra: "B",
  Menzies: "C",
  "Mount Magnet": "B",
  Norseman: "B",
  Nullagine: "C",
  Onslow: "A",
  "Port Hedland": "A",
  Sandstone: "B",
  Warmun: "C",
  Wiluna: "B",
  Wyndham: "A",
  Yalgoo: "B",
  Yungnora: "C",
} as const satisfies Record<string, "A" | "B" | "C">;

const HORIZON_TOWN_OPTIONS = Object.keys(HORIZON_POWER_TOWN_CLASSES)
  .sort((left, right) => left.localeCompare(right, "en-AU"))
  .map((town) => ({ value: town, label: town }));

const HORIZON_TOWN_INPUT: CreditexLocalInputDefinition = {
  key: "horizon_town",
  label: "Horizon Power town",
  type: "select",
  unit: "town",
  defaultValue: "Broome",
  help: "Choose the electricity service town. A postcode is not a safe substitute.",
  options: HORIZON_TOWN_OPTIONS,
};

function qcheuRegistryRequirements(activityCode: string) {
  if (activityCode === "PV") {
    return [
      "Clean Energy Council approved PV modules",
      "Clean Energy Council approved inverters",
      "New Energy Tech Approved Seller",
      "Solar Accreditation Australia accredited designer and installer",
    ];
  }
  if (activityCode === "HVAC") {
    return ["GEMS registered air conditioner and required heating/cooling star ratings"];
  }
  return [];
}

export const CREDITEX_LOCAL_PROGRAM_DEFINITIONS:
readonly CreditexLocalProgramDefinition[] = [
  {
    programCode: "QLD-SSR",
    jurisdiction: "QLD",
    name: "Supercharged Solar for Renters",
    outputUnit: "AUD",
    outputLabel: "Indicative rebate",
    effectiveFrom: "2025-12-12",
    effectiveTo: "",
    officialSourceUrl:
      "https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters/about",
    officialSourceTitle: "About the Supercharged Solar for Renters rebate",
    sourceVersion: "Queensland Government page and applicant guideline reviewed 8 August 2026",
    activities: QLD_SSR_ACTIVITY_ROWS.map(([activityCode, title, scenario]) => ({
      activityCode,
      title,
      scenario,
      formulaKey: `qld-ssr-${activityCode.toLowerCase()}-rebate/v1`,
      inputDefinitions: [
        {
          key: "panel_capacity_kw",
          label: "Total panel capacity",
          type: "decimal",
          unit: "kW",
          defaultValue: activityCode === "PV-3-4" ? "3.3" : activityCode === "PV-4-5" ? "4.4" : "6.6",
          minimum: "0",
          maximum: "100",
          help: "The program uses the lower of total panel capacity and inverter capacity.",
        },
        {
          key: "inverter_capacity_kw",
          label: "Total inverter capacity",
          type: "decimal",
          unit: "kW",
          defaultValue: activityCode === "PV-3-4" ? "3.3" : activityCode === "PV-4-5" ? "4.4" : "5",
          minimum: "0",
          maximum: "100",
          help: "The lower panel or inverter value determines the rebate band.",
        },
        COST_INPUT,
      ],
      productRegistryRequirements: [
        "Clean Energy Council approved PV modules",
        "Clean Energy Council approved inverters",
        "New Energy Tech Approved Seller",
        "Solar Accreditation Australia accredited designer and installer",
      ],
    })),
    operatorMessage:
      "The amount is an estimate only. Conditional approval, landlord, tenant, property, lease, seller, product and installer eligibility must all be confirmed before installation.",
  },
  {
    programCode: "QLD-QCHEU",
    jurisdiction: "QLD",
    name: "Queensland Community Housing Energy Upgrades",
    outputUnit: "AUD",
    outputLabel: "Indicative rebate",
    effectiveFrom: "2026-02-02",
    effectiveTo: "2027-06-30",
    officialSourceUrl:
      "https://www.business.qld.gov.au/industries/housing-accommodation/community/energy-upgrades/provider-owned-properties",
    officialSourceTitle: "Energy upgrades in community housing provider-owned properties",
    sourceVersion: "Queensland Government program page reviewed 8 August 2026",
    activities: QLD_QCHEU_ACTIVITY_ROWS.map(([activityCode, title]) => ({
      activityCode,
      title,
      scenario: activityCode === "COMMON-HW"
        ? "Common hot-water system allocated across all serviced dwellings"
        : activityCode === "FANS" || activityCode === "LED"
          ? "Supplementary measure installed with another eligible primary upgrade"
          : "Eligible upgrade for a provider-owned community housing dwelling",
      formulaKey: `qld-qcheu-${activityCode.toLowerCase()}-rebate/v1`,
      inputDefinitions: [
        DWELLING_INPUT,
        COST_EX_GST_INPUT,
        ...(activityCode === "FANS" || activityCode === "LED"
          ? [{
              key: "primary_upgrade_included",
              label: "Another eligible primary upgrade is included",
              type: "select" as const,
              unit: "boolean",
              defaultValue: "yes",
              help: "DC fans and LED lighting cannot be funded as standalone upgrades.",
              options: YES_NO_OPTIONS,
            }]
          : []),
      ],
      productRegistryRequirements: qcheuRegistryRequirements(activityCode),
    })),
    operatorMessage:
      "The estimate is the lesser of eligible GST-exclusive cost and $4,500 per dwelling. Funding cannot be pooled or averaged except for a common hot-water system, and formal conditional approval is required before works commence.",
  },
  {
    programCode: "QLD-FIT",
    jurisdiction: "QLD",
    name: "Regional Queensland solar feed-in tariffs",
    outputUnit: "AUD",
    outputLabel: "Indicative export credit",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2027-06-30",
    officialSourceUrl:
      "https://www.ergon.com.au/retail/business/tariffs-and-prices/solar-feed-in-tariff",
    officialSourceTitle: "Ergon Energy solar feed-in tariffs",
    sourceVersion: "2026 to 2027 regulated regional feed-in tariff",
    activities: [
      {
        activityCode: "REGIONAL",
        title: "Regional Queensland feed-in tariff",
        scenario: "Eligible regional Ergon Energy Retail exports",
        formulaKey: "qld-regional-fit-2026-27/v1",
        inputDefinitions: [EXPORT_INPUT],
        productRegistryRequirements: [],
      },
      {
        activityCode: "SBS-44C",
        title: "Grandfathered 44 cent Solar Bonus Scheme",
        scenario: "Existing continuously eligible legacy customer only",
        formulaKey: "qld-solar-bonus-44c/v1",
        inputDefinitions: [
          EXPORT_INPUT,
          {
            key: "legacy_eligibility_confirmed",
            label: "Continuous 44 cent eligibility confirmed",
            type: "select",
            unit: "boolean",
            defaultValue: "no",
            help: "Account, inverter, panel and battery changes can end legacy eligibility.",
            options: YES_NO_OPTIONS,
          },
        ],
        productRegistryRequirements: [],
      },
    ],
    operatorMessage:
      "This is a bill-credit estimate, not a certificate. Confirm the premises is supplied under the selected regional or grandfathered tariff before relying on it.",
  },
  {
    programCode: "WA-RBS",
    jurisdiction: "WA",
    name: "WA Residential Battery Scheme",
    outputUnit: "AUD",
    outputLabel: "Indicative state rebate",
    effectiveFrom: "2025-07-01",
    effectiveTo: "",
    officialSourceUrl:
      "https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme-eligibility-requirements",
    officialSourceTitle: "WA Residential Battery Scheme eligibility requirements",
    sourceVersion: "Eligibility requirements updated 15 April 2026",
    activities: [
      ["SYNERGY-BATTERY", "Residential battery in the Synergy service area", "Synergy customer and eligible VPP product"],
      ["HORIZON-BATTERY", "Residential battery in the Horizon Power service area", "Horizon Power customer and Community Wave"],
    ].map(([activityCode, title, scenario]) => ({
      activityCode,
      title,
      scenario,
      formulaKey: `wa-rbs-${activityCode.toLowerCase()}/v1`,
      inputDefinitions: [{
        key: "usable_capacity_kwh",
        label: "Usable battery capacity",
        type: "decimal",
        unit: "kWh",
        defaultValue: "10",
        minimum: "5",
        maximum: "1000",
        help: "The state rebate is paid on usable capacity from 5 kWh and capped at 10 kWh.",
      }],
      productRegistryRequirements: [
        "Clean Energy Council approved battery",
        "Clean Energy Council approved inverter",
        activityCode === "SYNERGY-BATTERY"
          ? "Synergy Supported Solution List"
          : "Horizon Power Supported Solution List",
        "Accredited scheme vendor",
        "Eligible Virtual Power Plant product",
      ],
    })),
    operatorMessage:
      "The state amount is separate from federal SRES battery STCs. The selected battery, inverter, vendor, service territory, connection and VPP pathway must all be current and eligible.",
  },
  {
    programCode: "WA-DEBS",
    jurisdiction: "WA",
    name: "Distributed Energy Buyback Scheme",
    outputUnit: "AUD",
    outputLabel: "Indicative export credit",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2027-06-30",
    officialSourceUrl: "https://www.horizonpower.com.au/utilities/pricing/",
    officialSourceTitle: "Horizon Power electricity fees and charges",
    sourceVersion: "Synergy current schedule and Horizon Power rates correct at 1 July 2026",
    activities: [{
      activityCode: "BUYBACK",
      title: "Distributed energy buyback tariff",
      scenario: "Eligible Synergy or Horizon Power customer",
      formulaKey: "wa-debs-2026-27/v1",
      inputDefinitions: [
        {
          key: "service_area",
          label: "Electricity service area",
          type: "select",
          unit: "service_area",
          defaultValue: "synergy",
          help: "Choose the retailer and network pathway shown on the electricity account.",
          options: [
            { value: "synergy", label: "Synergy / Western Power" },
            { value: "horizon", label: "Horizon Power" },
          ],
        },
        HORIZON_TOWN_INPUT,
        PEAK_EXPORT_INPUT,
        OFF_PEAK_EXPORT_INPUT,
      ],
      productRegistryRequirements: [],
    }],
    operatorMessage:
      "This is a tariff estimate, not a certificate. Synergy pays only the first 50 eligible exported kWh per day; aggregated inputs above that limit cannot be allocated safely without interval order. Horizon Power rates depend on the selected town.",
  },
  {
    programCode: "WA-BATTERY-REWARDS",
    jurisdiction: "WA",
    name: "Synergy Battery Rewards",
    outputUnit: "AUD",
    outputLabel: "Indicative activation credit",
    effectiveFrom: "2025-07-01",
    effectiveTo: "",
    officialSourceUrl:
      "https://www.synergy.net.au/-/media/Documents/Terms-and-conditions/DER-Battery-Rewards-Terms-and-conditions.pdf",
    officialSourceTitle: "Synergy Battery Rewards terms and conditions",
    sourceVersion: "Current Battery Rewards product details reviewed 8 August 2026",
    activities: [{
      activityCode: "ACTIVATION-EVENT",
      title: "Battery Rewards activation event",
      scenario: "Eligible export during one Synergy activation event",
      formulaKey: "wa-synergy-battery-rewards-event/v1",
      inputDefinitions: [
        {
          key: "event_export_kwh",
          label: "Metered event export",
          type: "decimal",
          unit: "kWh",
          defaultValue: "5",
          minimum: "0",
          maximum: "1000",
          help: "Only energy actually exported during the activation event earns this credit.",
        },
        {
          key: "installed_battery_capacity_kwh",
          label: "Installed battery capacity",
          type: "decimal",
          unit: "kWh",
          defaultValue: "10",
          minimum: "5",
          maximum: "1000",
          help: "Activation credits are capped at installed battery capacity per event.",
        },
      ],
      productRegistryRequirements: ["Compatible WA Residential Battery Scheme solution"],
    }],
    operatorMessage:
      "The current activation credit is $0.70 per eligible exported kWh, capped at installed battery capacity for each event. Energy-offset credits are a separate metered calculation.",
  },
  {
    programCode: "WA-HORIZON-BUYBACK",
    jurisdiction: "WA",
    name: "Horizon Power Buyback Bonus",
    outputUnit: "AUD",
    outputLabel: "Indicative export credit",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2027-06-30",
    officialSourceUrl: "https://www.horizonpower.com.au/utilities/pricing/",
    officialSourceTitle: "Horizon Power electricity fees and charges",
    sourceVersion: "Buyback Bonus rates correct at 1 July 2026",
    activities: [{
      activityCode: "EXPORT",
      title: "Community Wave Buyback Bonus exports",
      scenario: "Eligible Community Wave system over 5 kW or paired with a battery",
      formulaKey: "wa-horizon-buyback-bonus-2026-27/v1",
      inputDefinitions: [HORIZON_TOWN_INPUT, PEAK_EXPORT_INPUT, OFF_PEAK_EXPORT_INPUT],
      productRegistryRequirements: ["Community Wave compatible inverter or battery"],
    }],
    operatorMessage:
      "Rates depend on the Horizon Power town, season and export time. Confirm Community Wave eligibility and use accepted interval-meter exports.",
  },
  {
    programCode: "TAS-POWERSMART",
    jurisdiction: "TAS",
    name: "PowerSmart for Small Business",
    outputUnit: "AUD",
    outputLabel: "Indicative audit grant",
    effectiveFrom: "2024-04-12",
    effectiveTo: "",
    officialSourceUrl:
      "https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/powersmart_for_small_business",
    officialSourceTitle: "PowerSmart for Small Business",
    sourceVersion: "Tasmanian Government program page reviewed 8 August 2026",
    activities: [{
      activityCode: "AUDIT",
      title: "Independent small-business energy audit",
      scenario: "Eligible completed and paid independent energy audit",
      formulaKey: "tas-powersmart-audit-grant/v1",
      inputDefinitions: [COST_INPUT],
      productRegistryRequirements: [],
    }],
    operatorMessage:
      "The grant reimburses eligible paid audit cost up to $1,000. Business, employee-count, Tasmanian operation and audit-scope eligibility still require program assessment.",
  },
  {
    programCode: "TAS-FIT",
    jurisdiction: "TAS",
    name: "Tasmanian regulated feed-in tariff",
    outputUnit: "AUD",
    outputLabel: "Indicative export credit",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2027-06-30",
    officialSourceUrl:
      "https://www.economicregulator.tas.gov.au/electricity/pricing/feed-in-tariffs",
    officialSourceTitle: "Office of the Tasmanian Economic Regulator feed-in tariffs",
    sourceVersion: "2026 to 2027 regulated minimum feed-in tariff",
    activities: [{
      activityCode: "EXPORT",
      title: "Distributed generation export tariff",
      scenario: "Eligible mainland Tasmania or Bruny Island net exports",
      formulaKey: "tas-regulated-fit-2026-27/v1",
      inputDefinitions: [EXPORT_INPUT],
      productRegistryRequirements: [],
    }],
    operatorMessage:
      "The regulated minimum rate is 9.276 cents per eligible exported kWh. Confirm network location and retailer eligibility; Bass Strait islands use separate arrangements.",
  },
  {
    programCode: "NT-SMD",
    jurisdiction: "NT",
    name: "Solar for Multi Dwellings Grant Scheme",
    outputUnit: "AUD",
    outputLabel: "Indicative grant",
    effectiveFrom: "2024-12-01",
    effectiveTo: "2027-12-31",
    officialSourceUrl:
      "https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme",
    officialSourceTitle: "Solar for Multi Dwellings Grant Scheme",
    sourceVersion: "Northern Territory Government program page and terms reviewed 8 August 2026",
    activities: [
      ["SHARED-PV", "Shared rooftop solar PV"],
      ["SOLAR-SHARING", "Solar-sharing technology"],
      ["SMART-METER", "Relevant smart metering"],
      ["BATTERY", "Battery installed with the shared system"],
    ].map(([activityCode, title]) => ({
      activityCode,
      title,
      scenario: "Eligible component of one approved multi-dwelling project",
      formulaKey: `nt-smd-${activityCode.toLowerCase()}-grant/v1`,
      inputDefinitions: [
        { ...DWELLING_INPUT, minimum: "2", defaultValue: "10" },
        COST_EX_GST_INPUT,
      ],
      productRegistryRequirements: activityCode === "SHARED-PV"
        ? ["Clean Energy Council approved PV modules and inverters"]
        : activityCode === "BATTERY"
          ? ["Applicable approved battery and inverter products"]
          : [],
    })),
    operatorMessage:
      "The grant is the lesser of $7,500 per eligible dwelling and 50 percent of GST-exclusive eligible installation cost. Formal assessment, conditional approval and an executed grant agreement are required.",
  },
  {
    programCode: "NT-FIT",
    jurisdiction: "NT",
    name: "Jacana Energy solar feed-in tariffs",
    outputUnit: "AUD",
    outputLabel: "Indicative export credit",
    effectiveFrom: "2026-07-01",
    effectiveTo: "2027-06-30",
    officialSourceUrl:
      "https://www.jacanaenergy.com.au/index.php/residential/pricing",
    officialSourceTitle: "Jacana Energy residential pricing and tariffs",
    sourceVersion: "Rates valid 1 July 2026 to 30 June 2027",
    activities: [{
      activityCode: "EXPORT",
      title: "Distributed generation export tariff",
      scenario: "Eligible Jacana Energy exports with interval metering",
      formulaKey: "nt-jacana-fit-2026-27/v1",
      inputDefinitions: [PEAK_EXPORT_INPUT, OFF_PEAK_EXPORT_INPUT],
      productRegistryRequirements: [],
    }],
    operatorMessage:
      "Eligible exports receive 18.66 cents per kWh from 3 pm to 9 pm with the qualifying smart-meter pathway and 9.33 cents at other times. Confirm retailer and network eligibility.",
  },
];

export function creditexLocalProgramDefinition(programCode: string) {
  return CREDITEX_LOCAL_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === programCode,
  );
}

export function creditexLocalActivityDefinition(
  programCode: string,
  activityCode: string,
) {
  return creditexLocalProgramDefinition(programCode)?.activities.find(
    (activity) => activity.activityCode === activityCode,
  );
}
