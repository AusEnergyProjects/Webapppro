export const GOVERNMENT_CATALOGUE_REVIEWED_ON = "2026-08-01";

export const COMPLIANCE_OUTCOME_CLASSES = [
  "tradable_certificate",
  "retailer_obligation_credit",
  "rebate",
  "grant",
  "loan",
  "project_credit",
  "tariff_only",
  "procurement_only",
] as const;

export type ComplianceOutcomeClass =
  typeof COMPLIANCE_OUTCOME_CLASSES[number];

export type GovernmentCatalogueState =
  | "current"
  | "limited"
  | "future"
  | "specialist"
  | "closed";

export type GovernmentProgramTemplate = {
  templateId: string;
  programCode: string;
  name: string;
  jurisdiction: "AU" | "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA";
  outcomeClass: ComplianceOutcomeClass;
  administeringBody: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  catalogueState: GovernmentCatalogueState;
  operatingNote: string;
};

export type GovernmentActivityTemplate = {
  templateId: string;
  programCode: string;
  activityKey: string;
  registryActivityCode: string;
  title: string;
  serviceCategory:
    | "assessment"
    | "solar"
    | "battery"
    | "heating-cooling"
    | "hot-water"
    | "draught-proofing"
    | "insulation"
    | "glazing"
    | "window-coverings"
    | "ev-charging"
    | "electrical"
    | "plumbing"
    | "mounting-hardware"
    | "controls"
    | "other";
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  catalogueState: GovernmentCatalogueState;
};

export const GOVERNMENT_PROGRAM_TEMPLATES: readonly GovernmentProgramTemplate[] = [
  {
    templateId: "au-sres",
    programCode: "SRES",
    name: "Small-scale Renewable Energy Scheme",
    jurisdiction: "AU",
    outcomeClass: "tradable_certificate",
    administeringBody: "Clean Energy Regulator",
    officialSourceUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates",
    officialSourceTitle: "Create small-scale technology certificates",
    catalogueState: "current",
    operatingNote: "STCs are created through the REC Registry by an eligible owner or registered agent. Product lists, deeming periods and evidence requirements are dynamic.",
  },
  {
    templateId: "au-lret",
    programCode: "LRET",
    name: "Large-scale Renewable Energy Target",
    jurisdiction: "AU",
    outcomeClass: "tradable_certificate",
    administeringBody: "Clean Energy Regulator",
    officialSourceUrl: "https://cer.gov.au/schemes/renewable-energy-target/renewable-energy-target-participants-and-industry/power-stations",
    officialSourceTitle: "Power stations under the Renewable Energy Target",
    catalogueState: "specialist",
    operatingNote: "LGC creation requires an accredited power station and is not an ordinary household installation claim.",
  },
  {
    templateId: "au-rego",
    programCode: "REGO",
    name: "Renewable Electricity Guarantee of Origin",
    jurisdiction: "AU",
    outcomeClass: "tradable_certificate",
    administeringBody: "Clean Energy Regulator",
    officialSourceUrl: "https://cer.gov.au/schemes/guarantee-origin-scheme/renewable-electricity-guarantee-origin/eligibility-rego",
    officialSourceTitle: "Eligibility for Renewable Electricity Guarantee of Origin certificates",
    catalogueState: "specialist",
    operatingNote: "Facility registration, metering and double-counting controls apply. Aggregated systems are not currently an ordinary installer pathway.",
  },
  {
    templateId: "au-accu",
    programCode: "ACCU",
    name: "Australian Carbon Credit Unit Scheme",
    jurisdiction: "AU",
    outcomeClass: "project_credit",
    administeringBody: "Clean Energy Regulator",
    officialSourceUrl: "https://cer.gov.au/schemes/australian-carbon-credit-unit-scheme/accu-scheme-methods",
    officialSourceTitle: "Australian Carbon Credit Unit Scheme methods",
    catalogueState: "specialist",
    operatingNote: "Project registration, additionality, baselines, monitoring, reporting and audit apply. This is not a simple installation certificate.",
  },
  {
    templateId: "au-household-energy-upgrades-fund",
    programCode: "HEUF",
    name: "Household Energy Upgrades Fund",
    jurisdiction: "AU",
    outcomeClass: "loan",
    administeringBody: "Australian Government",
    officialSourceUrl: "https://www.energy.gov.au/households/household-energy-upgrades-fund",
    officialSourceTitle: "Household Energy Upgrades Fund",
    catalogueState: "limited",
    operatingNote: "Finance is delivered through participating lenders and must remain separate from any certificate claim.",
  },
  {
    templateId: "au-social-housing-energy-performance",
    programCode: "SHEPI",
    name: "Social Housing Energy Performance Initiative",
    jurisdiction: "AU",
    outcomeClass: "procurement_only",
    administeringBody: "Department of Climate Change, Energy, the Environment and Water",
    officialSourceUrl: "https://www.dcceew.gov.au/energy/programs/social-housing",
    officialSourceTitle: "Social Housing Energy Performance Initiative",
    catalogueState: "specialist",
    operatingNote: "Government and housing-provider delivery program, not an open installer certificate route.",
  },
  {
    templateId: "vic-veu",
    programCode: "VEU",
    name: "Victorian Energy Upgrades",
    jurisdiction: "VIC",
    outcomeClass: "tradable_certificate",
    administeringBody: "Essential Services Commission Victoria",
    officialSourceUrl: "https://www.energy.vic.gov.au/victorian-energy-upgrades/installers/industry-specifications",
    officialSourceTitle: "Victorian Energy Upgrades industry specifications",
    catalogueState: "current",
    operatingNote: "Only an Accredited Person can create VEECs. Exact parts, categories, scenarios, product registers and clause commencement dates must be source-pinned.",
  },
  {
    templateId: "vic-solar-pv-rebate",
    programCode: "SOLAR-VIC-PV",
    name: "Solar panel rebate",
    jurisdiction: "VIC",
    outcomeClass: "rebate",
    administeringBody: "Solar Victoria",
    officialSourceUrl: "https://www.solar.vic.gov.au/solar-panel-rebate",
    officialSourceTitle: "Solar panel rebate",
    catalogueState: "current",
    operatingNote: "Administrative rebate and optional loan. It is separate from SRES STCs.",
  },
  {
    templateId: "vic-hot-water-rebate",
    programCode: "SOLAR-VIC-HW",
    name: "Hot water rebate",
    jurisdiction: "VIC",
    outcomeClass: "rebate",
    administeringBody: "Solar Victoria",
    officialSourceUrl: "https://www.solar.vic.gov.au/hot-water-rebate",
    officialSourceTitle: "Hot water rebate",
    catalogueState: "current",
    operatingNote: "Approved product, installer, household and property rules are independently versioned.",
  },
  {
    templateId: "vic-rental-solar",
    programCode: "SOLAR-VIC-RENTAL",
    name: "Solar for rental properties",
    jurisdiction: "VIC",
    outcomeClass: "rebate",
    administeringBody: "Solar Victoria",
    officialSourceUrl: "https://www.solar.vic.gov.au/solar-rental-properties",
    officialSourceTitle: "Solar for rental properties",
    catalogueState: "current",
    operatingNote: "Landlord and renter consent and the current Solar Victoria process apply.",
  },
  {
    templateId: "vic-community-housing-solar",
    programCode: "SOLAR-VIC-CH",
    name: "Solar for Community Housing",
    jurisdiction: "VIC",
    outcomeClass: "grant",
    administeringBody: "Solar Victoria",
    officialSourceUrl: "https://www.solar.vic.gov.au/solar-community-housing",
    officialSourceTitle: "Solar for Community Housing",
    catalogueState: "current",
    operatingNote: "Housing-provider program, not a VEEC activity.",
  },
  {
    templateId: "vic-apartments-solar",
    programCode: "SOLAR-VIC-APT",
    name: "Solar for Apartments",
    jurisdiction: "VIC",
    outcomeClass: "grant",
    administeringBody: "Solar Victoria",
    officialSourceUrl: "https://www.solar.vic.gov.au/solar-apartments",
    officialSourceTitle: "Solar for Apartments",
    catalogueState: "current",
    operatingNote: "Owners corporation, shared-system, approval and milestone rules apply.",
  },
  {
    templateId: "nsw-ess",
    programCode: "NSW-ESS",
    name: "Energy Savings Scheme",
    jurisdiction: "NSW",
    outcomeClass: "tradable_certificate",
    administeringBody: "IPART",
    officialSourceUrl: "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF",
    officialSourceTitle: "Energy Savings Scheme Rule of 2009, 1 July 2026",
    catalogueState: "current",
    operatingNote: "An Accredited Certificate Provider nominated as Energy Saver creates ESCs. Product suspensions, activity commencements and method guides remain date-sensitive.",
  },
  {
    templateId: "nsw-pdrs",
    programCode: "NSW-PDRS",
    name: "Peak Demand Reduction Scheme",
    jurisdiction: "NSW",
    outcomeClass: "tradable_certificate",
    administeringBody: "IPART",
    officialSourceUrl: "https://www.energysustainabilityschemes.nsw.gov.au/pdrs-rule-and-changes",
    officialSourceTitle: "Peak Demand Reduction Scheme rule and changes",
    catalogueState: "current",
    operatingNote: "An Accredited Certificate Provider nominated as Capacity Holder creates PRCs. Exact rule and method versions must be resolved for the activity date.",
  },
  {
    templateId: "nsw-home-energy-saver",
    programCode: "NSW-HES",
    name: "Home Energy Saver",
    jurisdiction: "NSW",
    outcomeClass: "loan",
    administeringBody: "NSW Government",
    officialSourceUrl: "https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver",
    officialSourceTitle: "Home Energy Saver",
    catalogueState: "limited",
    operatingNote: "Current loan workflow is administrative. Future discount rules and the Creditex operating interface must remain disabled until officially issued.",
  },
  {
    templateId: "nsw-solar-apartments",
    programCode: "NSW-SAR",
    name: "Solar for Apartment Residents",
    jurisdiction: "NSW",
    outcomeClass: "grant",
    administeringBody: "NSW Government",
    officialSourceUrl: "https://www.energy.nsw.gov.au/households/grants-rebates/solar-for-apartment-residents",
    officialSourceTitle: "Solar for Apartment Residents",
    catalogueState: "current",
    operatingNote: "Shared solar grant with owners corporation, design and milestone evidence.",
  },
  {
    templateId: "act-eeis",
    programCode: "ACT-EEIS",
    name: "Energy Efficiency Improvement Scheme",
    jurisdiction: "ACT",
    outcomeClass: "retailer_obligation_credit",
    administeringBody: "ACT Government",
    officialSourceUrl: "https://www.legislation.act.gov.au/DownloadFile/ni/2025-184/current/PDF/2025-184.PDF",
    officialSourceTitle: "Energy Efficiency Improvement Scheme Activity Code",
    catalogueState: "limited",
    operatingNote: "Activities create retailer-obligation energy savings factors, not tradable certificates. A verified retailer or AESP route is required.",
  },
  {
    templateId: "act-sustainable-household",
    programCode: "ACT-SHS",
    name: "Sustainable Household Scheme",
    jurisdiction: "ACT",
    outcomeClass: "loan",
    administeringBody: "ACT Government",
    officialSourceUrl: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-household-scheme",
    officialSourceTitle: "Sustainable Household Scheme",
    catalogueState: "current",
    operatingNote: "Administrative loan pathway with approved suppliers and technologies.",
  },
  {
    templateId: "act-home-energy-support",
    programCode: "ACT-HES",
    name: "Home Energy Support Program",
    jurisdiction: "ACT",
    outcomeClass: "rebate",
    administeringBody: "ACT Government",
    officialSourceUrl: "https://www.climatechoices.act.gov.au/policy-programs/home-energy-support-rebates-for-homeowners",
    officialSourceTitle: "Home Energy Support rebates for homeowners",
    catalogueState: "current",
    operatingNote: "Eligibility and approved technology routes are controlled by the current government program.",
  },
  {
    templateId: "act-sustainable-business",
    programCode: "ACT-SBP",
    name: "Sustainable Business Program",
    jurisdiction: "ACT",
    outcomeClass: "grant",
    administeringBody: "ACT Government",
    officialSourceUrl: "https://www.climatechoices.act.gov.au/policy-programs/sustainable-business-program",
    officialSourceTitle: "Sustainable Business Program",
    catalogueState: "current",
    operatingNote: "Business audit and electrification assistance, not a certificate.",
  },
  {
    templateId: "act-solar-apartments",
    programCode: "ACT-SFA",
    name: "Solar for Apartments",
    jurisdiction: "ACT",
    outcomeClass: "grant",
    administeringBody: "ACT Government",
    officialSourceUrl: "https://www.climatechoices.act.gov.au/policy-programs/solar-for-apartments-program",
    officialSourceTitle: "Solar for Apartments Program",
    catalogueState: "current",
    operatingNote: "Grant and loan pathway for apartment buildings.",
  },
  {
    templateId: "sa-reps",
    programCode: "SA-REPS",
    name: "Retailer Energy Productivity Scheme",
    jurisdiction: "SA",
    outcomeClass: "retailer_obligation_credit",
    administeringBody: "ESCOSA",
    officialSourceUrl: "https://www.energymining.sa.gov.au/industry/energy-efficiency-and-productivity/retailer-energy-productivity-scheme-reps/reps-activity-specifications",
    officialSourceTitle: "REPS activity specifications",
    catalogueState: "limited",
    operatingNote: "Activities create normalised GJ toward retailer obligations, not tradable certificates. Current public Creditex scope is limited to WH1, HC2A and HC2B.",
  },
  {
    templateId: "qld-solar-renters",
    programCode: "QLD-SSR",
    name: "Supercharged Solar for Renters",
    jurisdiction: "QLD",
    outcomeClass: "rebate",
    administeringBody: "Queensland Government",
    officialSourceUrl: "https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters",
    officialSourceTitle: "Supercharged Solar for Renters",
    catalogueState: "current",
    operatingNote: "Conditional approval is required before installation. STCs remain a separate national outcome.",
  },
  {
    templateId: "qld-community-housing-upgrades",
    programCode: "QLD-QCHEU",
    name: "Queensland Community Housing Energy Upgrades",
    jurisdiction: "QLD",
    outcomeClass: "grant",
    administeringBody: "Queensland Government",
    officialSourceUrl: "https://www.business.qld.gov.au/industries/housing-accommodation/community/energy-upgrades/provider-owned-properties",
    officialSourceTitle: "Community housing energy upgrades for provider-owned properties",
    catalogueState: "current",
    operatingNote: "Applications close 30 October 2026 and installations must meet the current milestone and measure rules.",
  },
  {
    templateId: "qld-existing-home-rating",
    programCode: "QLD-HER",
    name: "Home Energy Rating for existing homes",
    jurisdiction: "QLD",
    outcomeClass: "procurement_only",
    administeringBody: "Queensland Government",
    officialSourceUrl: "https://www.chde.qld.gov.au/initiatives/modern-homes/home-energy-rating-existing-homes",
    officialSourceTitle: "Home Energy Rating for existing homes",
    catalogueState: "current",
    operatingNote: "Accredited assessment and certificate service, not a rebate or tradeable energy certificate scheme.",
  },
  {
    templateId: "wa-residential-battery",
    programCode: "WA-RBS",
    name: "WA Residential Battery Scheme",
    jurisdiction: "WA",
    outcomeClass: "rebate",
    administeringBody: "Energy Policy WA",
    officialSourceUrl: "https://www.wa.gov.au/organisation/energy-policy-wa/wa-residential-battery-scheme-eligibility-requirements",
    officialSourceTitle: "WA Residential Battery Scheme eligibility requirements",
    catalogueState: "current",
    operatingNote: "State rebate and optional loan are separate from federal battery STCs. Product, VPP and network lists are dynamic.",
  },
  {
    templateId: "wa-debs",
    programCode: "WA-DEBS",
    name: "Distributed Energy Buyback Scheme",
    jurisdiction: "WA",
    outcomeClass: "tariff_only",
    administeringBody: "Energy Policy WA",
    officialSourceUrl: "https://www.wa.gov.au/organisation/energy-policy-wa/energy-buyback-schemes",
    officialSourceTitle: "Energy buyback schemes",
    catalogueState: "current",
    operatingNote: "Tariff and network registration pathway, not a certificate.",
  },
  {
    templateId: "tas-nils-energy-saver",
    programCode: "TAS-NILS-ES",
    name: "NILS Tasmania Energy Saver support",
    jurisdiction: "TAS",
    outcomeClass: "loan",
    administeringBody: "Tasmanian Government delivery partners",
    officialSourceUrl: "https://www.recfit.tas.gov.au/grants_programs/energy/energy_bill_relief",
    officialSourceTitle: "Tasmanian energy bill relief and Energy Saver support",
    catalogueState: "limited",
    operatingNote: "The current detailed product catalogue and subsidy rules require authoritative delivery-provider confirmation before activation.",
  },
  {
    templateId: "tas-powersmart",
    programCode: "TAS-POWERSMART",
    name: "PowerSmart for Small Business",
    jurisdiction: "TAS",
    outcomeClass: "grant",
    administeringBody: "Renewables, Climate and Future Industries Tasmania",
    officialSourceUrl: "https://www.recfit.tas.gov.au/grants_programs/energy-efficiency/powersmart_for_small_business",
    officialSourceTitle: "PowerSmart for Small Business",
    catalogueState: "current",
    operatingNote: "Reimburses an independent energy audit, not installation works or certificates.",
  },
  {
    templateId: "tas-feed-in-tariff",
    programCode: "TAS-FIT",
    name: "Tasmanian feed-in tariff",
    jurisdiction: "TAS",
    outcomeClass: "tariff_only",
    administeringBody: "Office of the Tasmanian Economic Regulator",
    officialSourceUrl: "https://www.economicregulator.tas.gov.au/electricity/pricing/feed-in-tariffs",
    officialSourceTitle: "Tasmanian feed-in tariffs",
    catalogueState: "current",
    operatingNote: "Tariff, connection and DER registration pathway, not a certificate.",
  },
  {
    templateId: "nt-solar-multi-dwellings",
    programCode: "NT-SMD",
    name: "Solar for Multi Dwellings Grant Scheme",
    jurisdiction: "NT",
    outcomeClass: "grant",
    administeringBody: "Northern Territory Government",
    officialSourceUrl: "https://nt.gov.au/industry/business-grants-funding/solar-for-multi-dwellings-grant-scheme",
    officialSourceTitle: "Solar for Multi Dwellings Grant Scheme",
    catalogueState: "current",
    operatingNote: "Conditional approval and an executed funding agreement are required before work. STCs remain a separate national outcome.",
  },
  {
    templateId: "nt-feed-in-tariff",
    programCode: "NT-FIT",
    name: "Northern Territory feed-in tariffs",
    jurisdiction: "NT",
    outcomeClass: "tariff_only",
    administeringBody: "Jacana Energy",
    officialSourceUrl: "https://www.jacanaenergy.com.au/index.php/residential/pricing",
    officialSourceTitle: "Jacana Energy residential pricing",
    catalogueState: "current",
    operatingNote: "Retail tariff pathway, not a certificate.",
  },
];

function activity(
  programCode: string,
  code: string,
  title: string,
  serviceCategory: GovernmentActivityTemplate["serviceCategory"],
  options: Partial<Pick<
    GovernmentActivityTemplate,
    "catalogueState" | "specificationPart" | "productCategory" | "scenarioCode" | "scenario"
  >> = {},
): GovernmentActivityTemplate {
  const key = code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    templateId: `${programCode.toLowerCase()}-${key}`,
    programCode,
    activityKey: key,
    registryActivityCode: code,
    title,
    serviceCategory,
    specificationPart: options.specificationPart ?? "",
    productCategory: options.productCategory ?? title,
    scenarioCode: options.scenarioCode ?? "",
    scenario: options.scenario ?? "No separate government scenario code",
    catalogueState: options.catalogueState ?? "current",
  };
}

const SRES_ACTIVITIES = [
  activity("SRES", "PV", "Small-scale solar PV system", "solar"),
  activity("SRES", "BESS", "Eligible solar battery", "battery"),
  activity("SRES", "WIND", "Small wind system", "electrical"),
  activity("SRES", "HYDRO", "Small hydro system", "electrical"),
  activity("SRES", "SWH", "Solar water heater", "hot-water"),
  activity("SRES", "ASHP", "Air-source heat-pump water heater", "hot-water"),
];

const SPECIALIST_NATIONAL_ACTIVITIES = [
  activity("LRET", "POWER-STATION", "Accredited renewable power station generation", "other", { catalogueState: "specialist" }),
  activity("REGO", "GENERATION", "Eligible renewable electricity generation", "other", { catalogueState: "specialist" }),
  activity("REGO", "STORAGE", "Eligible storage discharge", "battery", { catalogueState: "specialist" }),
  activity("ACCU", "ICER", "Industrial and Commercial Emissions Reduction", "other", { catalogueState: "specialist" }),
  activity("ACCU", "IEU", "Industrial Equipment Upgrades", "other", { catalogueState: "specialist" }),
];

const VEU_ACTIVITIES = [
  activity("VEU", "1", "Solar or heat-pump water heater replacing electric resistance", "hot-water", { specificationPart: "1" }),
  activity("VEU", "3", "Heat-pump or solar water heater replacing gas or LPG", "hot-water", { specificationPart: "3" }),
  activity("VEU", "6(23)", "High-efficiency air conditioning", "heating-cooling", {
    specificationPart: "6",
    productCategory: "",
    scenario: "",
  }),
  activity("VEU", "13", "WERS-rated double glazing", "glazing", { specificationPart: "13" }),
  activity("VEU", "14", "Secondary glazing, acrylic panel or insulating film", "glazing", { specificationPart: "14" }),
  activity("VEU", "15", "Draught sealing", "draught-proofing", { specificationPart: "15" }),
  activity("VEU", "17", "WELS low-flow shower rose", "plumbing", { specificationPart: "17" }),
  activity("VEU", "22", "Refrigerators and freezers", "other", { specificationPart: "22" }),
  activity("VEU", "24", "High-efficiency television", "other", { specificationPart: "24" }),
  activity("VEU", "25", "High-efficiency clothes dryer", "other", { specificationPart: "25" }),
  activity("VEU", "26", "High-efficiency pool or spa pump", "other", { specificationPart: "26" }),
  activity("VEU", "27", "Public-lighting controls, replacement or removal", "electrical", { specificationPart: "27" }),
  activity("VEU", "28", "Flexible gas-heating ductwork upgrade", "heating-cooling", { specificationPart: "28" }),
  activity("VEU", "30", "In-home energy-use display", "controls", { specificationPart: "30" }),
  activity("VEU", "31", "High-efficiency three-phase induction motor", "electrical", { specificationPart: "31" }),
  activity("VEU", "32", "Refrigerated display or storage cabinet", "other", { specificationPart: "32" }),
  activity("VEU", "33", "Efficient electronically commutated motor", "electrical", { specificationPart: "33" }),
  activity("VEU", "34", "Building-based lighting", "electrical", { specificationPart: "34" }),
  activity("VEU", "35", "Non-building lighting", "electrical", { specificationPart: "35" }),
  activity("VEU", "36", "High-efficiency pre-rinse spray valve", "plumbing", { specificationPart: "36" }),
  activity("VEU", "37", "Gas steam-boiler replacement", "other", { specificationPart: "37" }),
  activity("VEU", "38", "Gas boiler or water-heater replacement", "other", { specificationPart: "38" }),
  activity("VEU", "39", "Gas-to-air ratio control", "controls", { specificationPart: "39" }),
  activity("VEU", "40", "Combustion trim system", "controls", { specificationPart: "40" }),
  activity("VEU", "41", "Gas-fired burner replacement", "other", { specificationPart: "41" }),
  activity("VEU", "42", "Boiler economiser", "other", { specificationPart: "42" }),
  activity("VEU", "43", "Cold-room refrigeration controls and components", "controls", { specificationPart: "43" }),
  activity("VEU", "44", "Commercial or industrial heat-pump water heater", "hot-water", { specificationPart: "44" }),
  activity("VEU", "45", "Residential Efficiency Scorecard", "assessment", { specificationPart: "45", catalogueState: "closed" }),
  activity("VEU", "46", "Induction cooktop replacing gas or LPG cooking", "electrical", { specificationPart: "46" }),
  activity("VEU", "47", "Commercial or industrial solar PV", "solar", { specificationPart: "47" }),
  activity("VEU", "48", "Residential ceiling insulation", "insulation", { specificationPart: "48" }),
  activity("VEU", "PBA-MV", "Project-based Measurement and Verification", "assessment", { catalogueState: "specialist" }),
  activity("VEU", "PBA-BR", "Project-based Benchmark Rating", "assessment", { catalogueState: "specialist" }),
];

const NSW_ESS_ACTIVITY_ROWS: Array<[
  string,
  string,
  GovernmentActivityTemplate["serviceCategory"],
  GovernmentCatalogueState?,
]> = [
  ["C1", "Remove a spare refrigerator or freezer", "other"],
  ["C2", "Remove a primary refrigerator or freezer", "other"],
  ["D1", "Install high-efficiency windows or doors", "glazing"],
  ["D2", "Install secondary glazing", "glazing"],
  ["D5", "Install a high-efficiency pool pump", "other"],
  ["D6", "Install ceiling insulation at an uninsulated premises", "insulation", "future"],
  ["D7", "Top up ceiling insulation", "insulation", "future"],
  ["D8", "Install underfloor insulation", "insulation", "future"],
  ["D9", "Install wall insulation", "insulation", "future"],
  ["D13", "Install a natural roof ventilator", "other"],
  ["D14", "Install a fan-forced, PV or occupied ventilator", "electrical"],
  ["D15", "Install a self-sealing exhaust fan", "draught-proofing"],
  ["D16", "Install high-efficiency air conditioning", "heating-cooling"],
  ["D17", "Replace resistance water heating with heat-pump water heating", "hot-water"],
  ["D18", "Replace resistance water heating with solar electric-boost water heating", "hot-water"],
  ["D19", "Replace gas water heating with heat-pump water heating", "hot-water"],
  ["D20", "Replace gas water heating with solar electric-boost water heating", "hot-water"],
  ["E1", "Residential lighting activity E1", "electrical"],
  ["E2", "Residential lighting activity E2", "electrical"],
  ["E3", "Residential lighting activity E3", "electrical"],
  ["E4", "Residential lighting activity E4", "electrical"],
  ["E5", "Residential lighting activity E5", "electrical"],
  ["E6", "Install a low-flow showerhead", "plumbing"],
  ["E7", "Seal doors against draughts", "draught-proofing"],
  ["E8", "Seal windows against draughts", "draught-proofing"],
  ["E9", "Install a chimney damper", "draught-proofing"],
  ["E10", "Install an external blind", "window-coverings"],
  ["E11", "Install a screw or bayonet LED lamp", "electrical"],
  ["E12", "Seal an exhaust opening", "draught-proofing"],
  ["E13", "Replace T5 lighting with LED", "electrical"],
  ["F1.1", "Install a new refrigerated cabinet", "other"],
  ["F1.2", "Replace a refrigerated cabinet", "other"],
  ["F2", "Install a high-efficiency liquid chiller", "heating-cooling"],
  ["F3", "Install close-control air conditioning", "heating-cooling"],
  ["F4", "Install air conditioning at or above 30 kW", "heating-cooling"],
  ["F5", "Install an electronically commutated refrigerated motor", "electrical"],
  ["F6", "Install an electronically commutated ventilation motor", "electrical"],
  ["F7", "Install a high-efficiency three-phase induction motor", "electrical"],
  ["F10", "Install oxygen trim", "controls"],
  ["F11", "Replace a burner", "other"],
  ["F12", "Install an economiser", "other"],
  ["F13", "Install automatic boiler blowdown control", "controls"],
  ["F14", "Recover flash steam", "other"],
  ["F15", "Install a blowdown heat exchanger", "other"],
  ["F16", "Replace gas or resistance water heating with a heat pump", "hot-water"],
  ["F17", "Install a new commercial heat-pump water heater", "hot-water"],
];

const NSW_ESS_ACTIVITIES = NSW_ESS_ACTIVITY_ROWS.map(
  ([code, title, category, catalogueState]) =>
    activity("NSW-ESS", code, title, category, { catalogueState }),
);

const NSW_PDRS_ACTIVITIES = [
  activity("NSW-PDRS", "HVAC1", "Residential or small-business air conditioning peak reduction", "heating-cooling"),
  activity("NSW-PDRS", "HVAC2", "Large air conditioning peak reduction", "heating-cooling"),
  activity("NSW-PDRS", "RF2", "Refrigerated cabinet replacement peak reduction", "other"),
  activity("NSW-PDRS", "SYS2", "Pool pump peak reduction", "other"),
  activity("NSW-PDRS", "BESS1", "New behind-the-meter battery", "battery"),
  activity("NSW-PDRS", "BESS2", "Battery demand-response or VPP onboarding", "battery"),
  activity("NSW-PDRS", "BESS3", "Apartment battery", "battery", { catalogueState: "future" }),
  activity("NSW-PDRS", "BESS4", "Small-business battery", "battery", { catalogueState: "future" }),
  activity("NSW-PDRS", "BESS5", "Commercial or industrial battery", "battery", { catalogueState: "future" }),
  activity("NSW-PDRS", "V2G1", "Vehicle-to-grid activity", "ev-charging", { catalogueState: "future" }),
  activity("NSW-PDRS", "WH1", "Heat-pump water-heater peak reduction", "hot-water", { catalogueState: "closed" }),
];

const ACT_EEIS_ACTIVITY_ROWS: Array<[
  string,
  string,
  GovernmentActivityTemplate["serviceCategory"],
  GovernmentCatalogueState?,
]> = [
  ["1.1", "Building sealing", "draught-proofing"],
  ["1.2", "Exhaust-fan sealing", "draught-proofing"],
  ["1.3", "Ventilation-opening sealing", "draught-proofing"],
  ["1.4", "Thermally efficient windows", "glazing"],
  ["1.5", "Retrofit glazing", "glazing"],
  ["1.6", "Window coverings", "window-coverings"],
  ["1.7", "Pelmets", "window-coverings"],
  ["1.8", "Ceiling insulation", "insulation"],
  ["2.1", "Central heat-pump air conditioning", "heating-cooling"],
  ["2.2", "Ducted gas replacement", "heating-cooling", "closed"],
  ["2.3", "Room heat-pump air conditioning", "heating-cooling"],
  ["2.4", "Insulated ductwork", "heating-cooling"],
  ["2.5", "Replace separate central heating and cooling", "heating-cooling"],
  ["2.6", "Replace separate room heating and cooling", "heating-cooling"],
  ["3.1", "Replace electric-resistance water heating", "hot-water"],
  ["3.2", "Replace gas or LPG water heating", "hot-water"],
  ["3.3", "Install a low-flow shower outlet", "plumbing"],
  ["4.1", "Residential lighting", "electrical"],
  ["4.2", "Commercial lighting", "electrical", "limited"],
  ["5.1", "Decommission a refrigerator or freezer", "other"],
  ["5.2", "Install an efficient refrigerator or freezer", "other"],
  ["5.3", "Install an efficient clothes dryer", "other"],
  ["5.4", "Install an efficient television", "other"],
  ["5.5", "Standby power controller", "controls", "closed"],
  ["5.6", "Install an efficient pool pump", "other"],
  ["5.7", "Install a refrigerated display cabinet", "other"],
];

const ACT_EEIS_ACTIVITIES = ACT_EEIS_ACTIVITY_ROWS.map(
  ([code, title, category, catalogueState]) =>
    activity("ACT-EEIS", code, title, category, { catalogueState }),
);

const SA_REPS_ACTIVITY_ROWS: Array<[
  string,
  string,
  GovernmentActivityTemplate["serviceCategory"],
  GovernmentCatalogueState?,
]> = [
  ["APP1A", "Install an efficient refrigerator or refrigerator-freezer", "other"],
  ["APP1B", "Install an efficient freezer", "other"],
  ["APP1D", "Install an efficient clothes dryer", "other"],
  ["APP2", "Remove and dispose of a refrigerator or freezer", "other"],
  ["APP3", "Install an efficient pool pump", "other"],
  ["APP4", "Connect a pool pump to demand response", "controls"],
  ["EV1", "Connect an EV charger to demand response", "ev-charging"],
  ["RDC1", "Install an efficient refrigerated display cabinet", "other"],
  ["HC2A", "Install non-ducted reverse-cycle air conditioning", "heating-cooling", "limited"],
  ["HC2B", "Install ducted or multi-split reverse-cycle air conditioning", "heating-cooling", "limited"],
  ["HC2C", "Connect HVAC to an approved demand-response aggregator", "controls"],
  ["HC3", "Install ducted evaporative air conditioning", "heating-cooling"],
  ["BS1A", "Install ceiling insulation at an uninsulated premises", "insulation"],
  ["BS1B", "Top up ceiling insulation", "insulation"],
  ["BS2", "Building sealing", "draught-proofing"],
  ["BS3B", "Install secondary glazing", "glazing"],
  ["CL1", "Commercial lighting", "electrical"],
  ["WH1", "Install or replace a high-efficiency water heater", "hot-water", "limited"],
  ["WH2", "Install a low-flow shower", "plumbing"],
  ["WH3", "Move an electric water heater to a solar-sponge or off-peak tariff", "hot-water"],
  ["WH4", "Connect a heat-pump water heater to demand response", "hot-water"],
  ["TOU1", "Change a residential tariff to time of use", "controls"],
  ["VPP1", "Connect a battery to an approved VPP", "battery"],
  ["CB1", "Connect a community battery to a VPP", "battery"],
  ["CD1", "Commercial and industrial demand savings using PIAM&V", "assessment"],
  ["LF1", "Legacy large-facility productivity plan", "assessment", "limited"],
];

const SA_REPS_ACTIVITIES = SA_REPS_ACTIVITY_ROWS.map(
  ([code, title, category, catalogueState]) =>
    activity("SA-REPS", code, title, category, { catalogueState }),
);

const ADMINISTRATIVE_ACTIVITIES = [
  activity("SOLAR-VIC-PV", "PV", "Install an eligible rooftop solar PV system", "solar"),
  activity("SOLAR-VIC-HW", "HW", "Install an eligible heat-pump or solar hot-water system", "hot-water"),
  activity("SOLAR-VIC-RENTAL", "PV-RENTAL", "Install rooftop solar at a rental property", "solar"),
  activity("SOLAR-VIC-CH", "PV-COMMUNITY-HOUSING", "Install solar for community housing", "solar"),
  activity("SOLAR-VIC-APT", "PV-APARTMENT", "Install shared solar for apartments", "solar"),
  activity("NSW-HES", "PV", "Rooftop solar PV", "solar", { catalogueState: "limited" }),
  activity("NSW-HES", "BESS", "Home battery", "battery", { catalogueState: "limited" }),
  activity("NSW-HES", "HW", "Heat-pump or solar water heating", "hot-water", { catalogueState: "limited" }),
  activity("NSW-HES", "HVAC", "Reverse-cycle air conditioning", "heating-cooling", { catalogueState: "limited" }),
  activity("NSW-HES", "INSULATION", "Ceiling insulation", "insulation", { catalogueState: "limited" }),
  activity("NSW-HES", "GLAZING", "Double glazing", "glazing", { catalogueState: "limited" }),
  activity("NSW-HES", "COOKING", "Induction cooking", "electrical", { catalogueState: "limited" }),
  activity("NSW-HES", "EVSE", "Level-two EV charging", "ev-charging", { catalogueState: "limited" }),
  activity("NSW-HES", "DRAUGHT", "Draught proofing", "draught-proofing", { catalogueState: "limited" }),
  activity("NSW-HES", "FANS", "Ceiling fans", "electrical", { catalogueState: "limited" }),
  activity("NSW-HES", "SWITCHBOARD", "Switchboard work", "electrical", { catalogueState: "limited" }),
  activity("NSW-HES", "NATHERS", "Existing-home NatHERS assessment", "assessment", { catalogueState: "limited" }),
  activity("NSW-SAR", "SHARED-PV", "Shared rooftop solar PV for apartments", "solar"),
  activity("ACT-SHS", "HOME-UPGRADE", "Approved household energy upgrade", "other"),
  activity("ACT-HES", "PV", "Eligible rooftop solar support", "solar"),
  activity("ACT-HES", "ELECTRIFICATION", "Eligible electric appliance or insulation support", "other"),
  activity("ACT-SBP", "BUSINESS-AUDIT", "Business energy audit", "assessment"),
  activity("ACT-SBP", "BUSINESS-ELECTRIFICATION", "Business electrification support", "electrical"),
  activity("ACT-SFA", "SHARED-PV", "Apartment shared solar", "solar"),
  activity("QLD-SSR", "PV-3-4", "Rooftop solar from 3 kW to less than 4 kW", "solar"),
  activity("QLD-SSR", "PV-4-5", "Rooftop solar from 4 kW to less than 5 kW", "solar"),
  activity("QLD-SSR", "PV-5-PLUS", "Rooftop solar at or above 5 kW", "solar"),
  activity("QLD-QCHEU", "INSULATION", "Ceiling insulation", "insulation"),
  activity("QLD-QCHEU", "DRAUGHT", "Draught proofing", "draught-proofing"),
  activity("QLD-QCHEU", "COOKTOP", "Electric cooktop", "electrical"),
  activity("QLD-QCHEU", "OVEN", "Electric oven", "electrical"),
  activity("QLD-QCHEU", "HPWH", "Heat-pump water heating", "hot-water"),
  activity("QLD-QCHEU", "SWH", "Solar water heating", "hot-water"),
  activity("QLD-QCHEU", "COMMON-HW", "Common water heating", "hot-water"),
  activity("QLD-QCHEU", "SHADING", "Window shading", "window-coverings"),
  activity("QLD-QCHEU", "GLAZING", "High-performance glazing", "glazing"),
  activity("QLD-QCHEU", "HVAC", "Split-system air conditioning", "heating-cooling"),
  activity("QLD-QCHEU", "PV", "Solar PV", "solar"),
  activity("QLD-QCHEU", "FANS", "DC fans as a supplementary measure", "electrical"),
  activity("QLD-QCHEU", "LED", "LED lighting as a supplementary measure", "electrical"),
  activity("QLD-HER", "ASSESSMENT", "Existing-home energy rating", "assessment"),
  activity("WA-RBS", "SYNERGY-BATTERY", "Residential battery in the Synergy service area", "battery"),
  activity("WA-RBS", "HORIZON-BATTERY", "Residential battery in the Horizon Power service area", "battery"),
  activity("WA-DEBS", "BUYBACK", "Distributed energy buyback tariff", "solar"),
  activity("TAS-NILS-ES", "APPLIANCE", "Approved energy-efficient appliance support", "other", { catalogueState: "limited" }),
  activity("TAS-NILS-ES", "HEAT-PUMP", "Heat-pump support", "heating-cooling", { catalogueState: "limited" }),
  activity("TAS-POWERSMART", "AUDIT", "Independent small-business energy audit", "assessment"),
  activity("TAS-FIT", "EXPORT", "Distributed generation export tariff", "solar"),
  activity("NT-SMD", "SHARED-PV", "Shared rooftop solar PV", "solar"),
  activity("NT-SMD", "SOLAR-SHARING", "Solar-sharing technology", "controls"),
  activity("NT-SMD", "SMART-METER", "Relevant smart metering", "electrical"),
  activity("NT-SMD", "BATTERY", "Battery installed with the shared system", "battery"),
  activity("NT-FIT", "EXPORT", "Distributed generation export tariff", "solar"),
];

export const GOVERNMENT_ACTIVITY_TEMPLATES: readonly GovernmentActivityTemplate[] = [
  ...SRES_ACTIVITIES,
  ...SPECIALIST_NATIONAL_ACTIVITIES,
  ...VEU_ACTIVITIES,
  ...NSW_ESS_ACTIVITIES,
  ...NSW_PDRS_ACTIVITIES,
  ...ACT_EEIS_ACTIVITIES,
  ...SA_REPS_ACTIVITIES,
  ...ADMINISTRATIVE_ACTIVITIES,
];

export function governmentProgramTemplate(templateId: string) {
  return GOVERNMENT_PROGRAM_TEMPLATES.find(
    (program) => program.templateId === templateId,
  );
}

export function governmentActivityTemplates(programCode: string) {
  return GOVERNMENT_ACTIVITY_TEMPLATES.filter(
    (activityTemplate) => activityTemplate.programCode === programCode,
  );
}
