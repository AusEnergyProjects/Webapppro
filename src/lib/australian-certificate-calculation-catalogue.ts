import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type ComplianceOutcomeClass,
  type GovernmentCatalogueState,
  type GovernmentActivityTemplate,
  type GovernmentProgramTemplate,
} from "./australian-government-program-catalogue.ts";
import {
  CREDITEX_LOCAL_PROGRAM_DEFINITIONS,
  creditexLocalActivityDefinition,
  creditexLocalProgramDefinition,
} from "./creditex-local-program-catalogue.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
} from "./creditex-nsw-program-catalogue.ts";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
} from "./creditex-veu-calculator-catalogue.ts";
import { officialProductKindsForLocalActivity } from "./creditex-official-product-registry.ts";

export const CERTIFICATE_CALCULATION_CATALOGUE_REVIEWED_ON = "2026-08-09";

export const CERTIFICATE_CALCULATION_STATES = [
  "estimate_available",
  "partial_estimate_available",
  "governed_formula_required",
  "official_registry_required",
  "project_method_required",
  "activity_not_commenced",
  "activity_closed",
  "not_applicable",
] as const;

export type CertificateCalculationState =
  typeof CERTIFICATE_CALCULATION_STATES[number];

export const CERTIFICATE_CALCULATION_PATHWAYS = [
  "deterministic_local_estimate",
  "source_pinned_formula",
  "official_registry_or_calculator",
  "project_measurement_and_verification",
  "unavailable_activity",
  "administrative_program",
] as const;

export type CertificateCalculationPathway =
  typeof CERTIFICATE_CALCULATION_PATHWAYS[number];

export type CertificateCalculationUnit =
  | "STC"
  | "VEEC"
  | "ESC"
  | "PRC"
  | "LGC"
  | "REGO"
  | "ACCU"
  | "MWh"
  | "GJ"
  | "AUD"
  | "none";

export type GovernmentCalculationSourceWindow = {
  programCode: string;
  sourceKey: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string;
  scope: string;
  officialSourceUrl: string;
  independentApprovalRequired: boolean;
};

export type GovernmentActivityCalculationMethod = {
  activityTemplateId: string;
  programCode: string;
  registryActivityCode: string;
  activityTitle: string;
  catalogueState: GovernmentCatalogueState;
  outcomeClass: ComplianceOutcomeClass;
  unit: CertificateCalculationUnit;
  state: CertificateCalculationState;
  pathway: CertificateCalculationPathway;
  formulaKey: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  sourceVersion: string;
  sourceEffectiveFrom: string;
  sourceEffectiveTo: string;
  officialReconciliationRequired: boolean;
  certificateActionEnabled: false;
  operatorMessage: string;
};

export const GOVERNMENT_SUBMISSION_ROUTE_STATES = [
  "public_workflow_documented",
  "current_contract_required",
  "authorised_private_schema_required",
  "administrative_route",
] as const;

export type GovernmentSubmissionRouteState =
  typeof GOVERNMENT_SUBMISSION_ROUTE_STATES[number];

export type GovernmentProgramSubmissionRoute = {
  programCode: string;
  programName: string;
  channel: string;
  routeState: GovernmentSubmissionRouteState;
  adapterBoundary: string;
  externalSubmissionEnabled: false;
  operatorMessage: string;
};

export const GOVERNMENT_CALCULATION_SOURCE_WINDOWS:
readonly GovernmentCalculationSourceWindow[] = [
  {
    programCode: "SRES",
    sourceKey: "cer-sres-entitlement-2026-2030",
    version: "CER entitlement guidance reviewed 2 August 2026",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2030-12-31",
    scope:
      "Small generation units, registered solar water heaters, air-source heat pumps and eligible solar batteries",
    officialSourceUrl:
      "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements",
    independentApprovalRequired: true,
  },
  {
    programCode: "VEU",
    sourceKey: "veu-specifications-v24",
    version: "Victorian Energy Upgrades Specifications version 24",
    effectiveFrom: "2026-06-30",
    effectiveTo: "2026-07-20",
    scope: "All specification parts governed by version 24",
    officialSourceUrl:
      "https://www.energy.vic.gov.au/__data/assets/pdf_file/0031/792904/victorian-energy-upgrades-specifications-2018-version-24.pdf",
    independentApprovalRequired: true,
  },
  {
    programCode: "VEU",
    sourceKey: "veu-specifications-v25",
    version: "Victorian Energy Upgrades Specifications version 25",
    effectiveFrom: "2026-07-21",
    effectiveTo: "",
    scope:
      "All current specification parts; revised Part 6 calculations and minimum co-payments apply from 30 September 2026",
    officialSourceUrl:
      "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
    independentApprovalRequired: true,
  },
  {
    programCode: "NSW-ESS",
    sourceKey: "nsw-ess-rule-2026-07-01",
    version: "Energy Savings Scheme Rule of 2009, 1 July 2026",
    effectiveFrom: "2026-07-01",
    effectiveTo: "",
    scope:
      "Current ESS methods and activity definitions; product acceptance, suspensions and method guides remain separately effective-dated",
    officialSourceUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Energy-Savings-Scheme-Rule-of-2009-1-July-2026.PDF",
    independentApprovalRequired: true,
  },
  {
    programCode: "NSW-PDRS",
    sourceKey: "nsw-pdrs-rule-2026-07-01",
    version: "Peak Demand Reduction Scheme Rule of 2022, 1 July 2026",
    effectiveFrom: "2026-07-01",
    effectiveTo: "",
    scope:
      "Current PDRS methods; BESS3, BESS4 and BESS5 commence on 1 September 2026",
    officialSourceUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Peak-Demand-Reduction-Scheme-Rule-of-2022-1-July-2026.PDF",
    independentApprovalRequired: true,
  },
  ...CREDITEX_LOCAL_PROGRAM_DEFINITIONS.map((program) => ({
    programCode: program.programCode,
    sourceKey: `${program.programCode.toLowerCase()}-${program.effectiveFrom}`,
    version: program.sourceVersion,
    effectiveFrom: program.effectiveFrom,
    effectiveTo: program.effectiveTo,
    scope: program.activities.map((activity) => activity.activityCode).join(", "),
    officialSourceUrl: program.officialSourceUrl,
    independentApprovalRequired: true,
  })),
];

const PROGRAM_BY_CODE = new Map(
  GOVERNMENT_PROGRAM_TEMPLATES.map((program) => [
    program.programCode,
    program,
  ]),
);

const SOURCE_WINDOW_BY_PROGRAM = Map.groupBy(
  GOVERNMENT_CALCULATION_SOURCE_WINDOWS,
  (window) => window.programCode,
);

function submissionRouteForProgram(
  program: GovernmentProgramTemplate,
): GovernmentProgramSubmissionRoute {
  const common = {
    programCode: program.programCode,
    programName: program.name,
    externalSubmissionEnabled: false as const,
  };
  if (program.programCode === "SRES") {
    return {
      ...common,
      channel: "REC Registry calculator and registered-agent workflow",
      routeState: "public_workflow_documented",
      adapterBoundary: "authenticated_rec_registry_contract",
      operatorMessage:
        "Use the local STC estimator for preflight only, then reconcile eligibility and quantity through the current REC Registry workflow.",
    };
  }
  if (program.programCode === "VEU") {
    return {
      ...common,
      channel: "ESC VEU Registry bulk activity-submission API",
      routeState: "current_contract_required",
      adapterBoundary: "creditex_authorised_esc_registry_api",
      operatorMessage:
        "The API is an authorised submission transport, not a public calculator. Obtain the current API pack, sandbox and Creditex authorisation before implementing transport.",
    };
  }
  if (
    program.programCode === "NSW-ESS"
    || program.programCode === "NSW-PDRS"
  ) {
    return {
      ...common,
      channel: "TESSA CSV version 1.7 and authenticated portal",
      routeState: "public_workflow_documented",
      adapterBoundary: "tessa_csv_v1_7_preflight",
      operatorMessage:
        "Build a versioned CSV generator, importer and preflight validator. A successful upload validation is not regulator approval.",
    };
  }
  if (program.programCode === "ACT-EEIS") {
    return {
      ...common,
      channel: "Authorised retailer or AESP reporting route",
      routeState: "authorised_private_schema_required",
      adapterBoundary: "authorised_act_eeis_export",
      operatorMessage:
        "This retailer-obligation workflow requires an authorised reporting schema. It is not an open certificate-registry submission.",
    };
  }
  if (program.programCode === "SA-REPS") {
    return {
      ...common,
      channel: "REPS-R retailer reporting route",
      routeState: "authorised_private_schema_required",
      adapterBoundary: "authorised_sa_reps_export",
      operatorMessage:
        "This retailer-obligation workflow requires an authorised retailer file and reporting agreement.",
    };
  }
  if (["LRET", "REGO", "ACCU"].includes(program.programCode)) {
    return {
      ...common,
      channel: "Clean Energy Regulator project or facility registry",
      routeState: "current_contract_required",
      adapterBoundary: "cer_project_or_facility_registry",
      operatorMessage:
        "This specialist route requires an accredited facility or registered project and cannot be activated from an ordinary installer job.",
    };
  }
  return {
    ...common,
    channel: "Administering-body eligibility and funding workflow",
    routeState: "administrative_route",
    adapterBoundary: "program_specific_administrative_route",
    operatorMessage:
      "Manage eligibility, approvals and funding separately. This program must not create a certificate submission.",
  };
}

export const GOVERNMENT_PROGRAM_SUBMISSION_ROUTES:
readonly GovernmentProgramSubmissionRoute[] =
  GOVERNMENT_PROGRAM_TEMPLATES.map(submissionRouteForProgram);

function sresFormulaKey(activity: GovernmentActivityTemplate) {
  if (activity.registryActivityCode === "PV") {
    return "cer-sres-solar-pv-estimate/v1";
  }
  if (["WIND", "HYDRO"].includes(activity.registryActivityCode)) {
    return "cer-sres-wind-hydro-estimate/v1";
  }
  if (["SWH", "ASHP"].includes(activity.registryActivityCode)) {
    return "cer-sres-registered-water-heater-estimate/v1";
  }
  return "cer-sres-solar-battery-estimate/v1";
}

const VEU_FORMULA_READY_ACTIVITY_CODES = new Set([
  "1", "3", "6", "13", "14", "15", "17", "22", "24", "25", "26",
  "27", "28", "30", "31", "32", "33", "34", "35", "36",
  "37", "38", "39", "40", "41", "42", "43", "44", "46", "48",
]);

const VEU_EXECUTABLE_ACTIVITY_CODES = new Set([
  "1", "3", "6", "13", "15", "17", "22", "24", "25", "26",
  "27", "30", "31", "33", "34", "35", "36",
  "37", "38", "39", "40", "41", "42", "43",
  "44", "46", "48",
]);

const VEU_PARTIAL_ESTIMATE_ACTIVITY_MESSAGES: Readonly<Record<string, string>> = {
  "1": "Exact estimates are available for 1C small systems and supported 1D systems. The 1C medium-system Bs/Be conflict between official sources remains fail-closed.",
  "6": "Exact estimates are available for supported single-split and multi-split systems. Multi-split estimates use the approved outdoor unit plus the total connected indoor-unit capacities; packaged systems remain fail-closed.",
  "31": "Exact estimates are available for 31A motors selected from the installation-date GEMS register. Activity 31B remains fail-closed until an exact VEU-approved product contract is available.",
  "33": "Exact estimates are available for 33A products selected from the installation-date VEU Public Registry. Activity 33B remains fail-closed because the governed registry connector has no exact 33B product contract.",
  "34": "Exact estimates are available only for sites that are not required to comply with Building Code Part J6. The Part J6 baseline branch remains fail-closed.",
  "46": "Exact historical estimates require an installation-date-eligible Legacy VEU product. The current Public Registry has no Approved activity 46 product for a current installation.",
};

const NSW_EXECUTABLE_ACTIVITY_CODES = new Set([
  "HVAC1", "HVAC2", "RF2", "SYS2",
  "D5", "D16", "F4",
]);

const NSW_FORMULA_READY_REGISTRY_REQUIRED_CODES = new Set([
  "D17", "D18", "D19", "D20",
]);

const NSW_PDRS_FORMULA_READY_REGISTRY_REQUIRED_CODES = new Set([
  "BESS1", "BESS2",
]);

function veuFormulaKey(registryActivityCode: string) {
  const codes = registryActivityCode === "1"
    ? new Set(["1C", "1D"])
    : registryActivityCode === "3"
      ? new Set(["3C", "3D"])
      : new Set([registryActivityCode]);
  return CREDITEX_VEU_ACTIVITY_DEFINITIONS
    .filter((activity) => codes.has(activity.activityCode))
    .map((activity) => activity.formulaKey)
    .join("+");
}

function nswFormulaKey(programCode: string, registryActivityCode: string) {
  const estimatorProgramCode = programCode === "NSW-ESS"
    ? "NSW-ESS-2026"
    : "NSW-PDRS-2026";
  const program = CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
    (candidate) => candidate.programCode === estimatorProgramCode,
  );
  return program?.activities
    .filter((activity) => activity.officialActivityCode === registryActivityCode)
    .map((activity) => activity.formulaKey)
    .join("+") || "";
}

function sourceWindow(
  program: GovernmentProgramTemplate,
  activity: GovernmentActivityTemplate,
) {
  const windows = SOURCE_WINDOW_BY_PROGRAM.get(program.programCode) || [];
  if (program.programCode === "VEU") {
    return windows.find((window) => window.sourceKey.endsWith("v25"));
  }
  if (
    program.programCode === "NSW-PDRS"
    && ["BESS3", "BESS4", "BESS5"].includes(activity.registryActivityCode)
  ) {
    const current = windows[0];
    return current
      ? { ...current, effectiveFrom: "2026-09-01" }
      : undefined;
  }
  return windows[0];
}

function nonCertificateMethod(
  program: GovernmentProgramTemplate,
  activity: GovernmentActivityTemplate,
): GovernmentActivityCalculationMethod {
  const localProgram = creditexLocalProgramDefinition(program.programCode);
  const localActivity = creditexLocalActivityDefinition(
    program.programCode,
    activity.registryActivityCode,
  );
  if (localProgram && localActivity) {
    const controlledRegistryProductKinds = new Set([
      "pv_module",
      "inverter",
      "battery",
      "wa_synergy_supported_solution",
      "wa_horizon_supported_solution",
    ]);
    const controlledRegistryRequired = officialProductKindsForLocalActivity(
      program.programCode,
      activity.registryActivityCode,
    ).some((kind) => controlledRegistryProductKinds.has(kind));
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "AUD",
      state: controlledRegistryRequired
        ? "official_registry_required"
        : "estimate_available",
      pathway: controlledRegistryRequired
        ? "official_registry_or_calculator"
        : "deterministic_local_estimate",
      formulaKey: localActivity.formulaKey,
      officialSourceUrl: localProgram.officialSourceUrl,
      officialSourceTitle: localProgram.officialSourceTitle,
      sourceVersion: localProgram.sourceVersion,
      sourceEffectiveFrom: localProgram.effectiveFrom,
      sourceEffectiveTo: localProgram.effectiveTo,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage: controlledRegistryRequired
        ? `${localProgram.operatorMessage} Calculation remains fail-closed until every required controlled product source is lawfully ingested and date-locked. CER-hosted CEC data needs recorded reuse permission, and WA activities also need the applicable Synergy or Horizon supported-solution evidence.`
        : localProgram.operatorMessage,
    };
  }
  return {
    activityTemplateId: activity.templateId,
    programCode: program.programCode,
    registryActivityCode: activity.registryActivityCode,
    activityTitle: activity.title,
    catalogueState: activity.catalogueState,
    outcomeClass: program.outcomeClass,
    unit: "none",
    state: "not_applicable",
    pathway: "administrative_program",
    formulaKey: "no-certificate-calculation",
    officialSourceUrl: program.officialSourceUrl,
    officialSourceTitle: program.officialSourceTitle,
    sourceVersion: "",
    sourceEffectiveFrom: "",
    sourceEffectiveTo: "",
    officialReconciliationRequired: false,
    certificateActionEnabled: false,
    operatorMessage:
      "This pathway is a rebate, grant, loan, tariff or procurement program. TLink must manage eligibility and administration without inventing a certificate quantity.",
  };
}

function unavailableMethod(
  program: GovernmentProgramTemplate,
  activity: GovernmentActivityTemplate,
): GovernmentActivityCalculationMethod {
  const closed = activity.catalogueState === "closed";
  const unitByProgram: Record<string, CertificateCalculationUnit> = {
    SRES: "STC",
    VEU: "VEEC",
    "NSW-ESS": "ESC",
    "NSW-PDRS": "PRC",
    "ACT-EEIS": "MWh",
    "SA-REPS": "GJ",
    LRET: "LGC",
    REGO: "REGO",
    ACCU: "ACCU",
  };
  return {
    activityTemplateId: activity.templateId,
    programCode: program.programCode,
    registryActivityCode: activity.registryActivityCode,
    activityTitle: activity.title,
    catalogueState: activity.catalogueState,
    outcomeClass: program.outcomeClass,
    unit: unitByProgram[program.programCode] || "none",
    state: closed ? "activity_closed" : "activity_not_commenced",
    pathway: "unavailable_activity",
    formulaKey: closed
      ? "closed-activity-no-current-calculation"
      : "future-activity-no-current-calculation",
    officialSourceUrl: program.officialSourceUrl,
    officialSourceTitle: program.officialSourceTitle,
    sourceVersion: "",
    sourceEffectiveFrom: "",
    sourceEffectiveTo: "",
    officialReconciliationRequired: false,
    certificateActionEnabled: false,
    operatorMessage: closed
      ? "This activity is closed for current jobs. Retain it for historical audit and migration only; do not estimate or create current certificates."
      : "This activity has not commenced. Keep job creation, calculation and certificate actions unavailable until its official commencement is source-pinned.",
  };
}

function methodForActivity(
  activity: GovernmentActivityTemplate,
): GovernmentActivityCalculationMethod {
  const program = PROGRAM_BY_CODE.get(activity.programCode);
  if (!program) {
    throw new Error(
      `Calculation catalogue orphaned activity ${activity.templateId}.`,
    );
  }

  if (
    activity.catalogueState === "closed"
    || activity.catalogueState === "future"
  ) {
    return unavailableMethod(program, activity);
  }

  if (
    [
      "rebate",
      "grant",
      "loan",
      "tariff_only",
      "procurement_only",
    ].includes(program.outcomeClass)
  ) {
    return nonCertificateMethod(program, activity);
  }

  const window = sourceWindow(program, activity);
  const sourceFields = {
    officialSourceUrl: window?.officialSourceUrl || program.officialSourceUrl,
    officialSourceTitle: program.officialSourceTitle,
    sourceVersion: window?.version || "",
    sourceEffectiveFrom: window?.effectiveFrom || "",
    sourceEffectiveTo: window?.effectiveTo || "",
  };

  if (program.programCode === "SRES") {
    const executable = ["SWH", "ASHP"].includes(
      activity.registryActivityCode,
    );
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "STC",
      state: executable
        ? "estimate_available"
        : "official_registry_required",
      pathway: executable
        ? "deterministic_local_estimate"
        : "official_registry_or_calculator",
      formulaKey: sresFormulaKey(activity),
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage: executable
        ? "A deterministic estimate is available from the dated CER registered-product snapshot and postcode zone. The final quantity must still reconcile with the current REC Registry calculator before any STC action."
        : "The governed arithmetic is retained, but calculation stays fail-closed until every required approved component, system-design input, installation-date status and accreditation check is connected to a lawful controlled source. No STC action is enabled.",
    };
  }

  if (program.programCode === "VEU") {
    const formulaKey = veuFormulaKey(activity.registryActivityCode);
    if (VEU_FORMULA_READY_ACTIVITY_CODES.has(activity.registryActivityCode)) {
      const executable = VEU_EXECUTABLE_ACTIVITY_CODES.has(
        activity.registryActivityCode,
      );
      const partialMessage = VEU_PARTIAL_ESTIMATE_ACTIVITY_MESSAGES[
        activity.registryActivityCode
      ];
      return {
        activityTemplateId: activity.templateId,
        programCode: program.programCode,
        registryActivityCode: activity.registryActivityCode,
        activityTitle: activity.title,
        catalogueState: activity.catalogueState,
        outcomeClass: program.outcomeClass,
        unit: "VEEC",
        state: executable
          ? partialMessage
            ? "partial_estimate_available"
            : "estimate_available"
          : "official_registry_required",
        pathway: executable
          ? "deterministic_local_estimate"
          : "official_registry_or_calculator",
        formulaKey,
        ...sourceFields,
        officialReconciliationRequired: true,
        certificateActionEnabled: false,
        operatorMessage: executable
          ? partialMessage
            ? `${partialMessage} Every supported estimate still requires full activity, installation and product evidence reconciliation before any VEEC action.`
            : "The governed formula and every required official source are connected for an estimate. Reconcile full activity, installation and product evidence before any VEEC action."
          : "The governed formula is implemented and tested. Calculation stays fail-closed until every formula-critical official source is captured through a monitored immutable connector.",
      };
    }
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "VEEC",
      state: "governed_formula_required",
      pathway: "source_pinned_formula",
      formulaKey: `veu-part-${activity.specificationPart || activity.registryActivityCode}-pending`,
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage:
        "Retain the exact applicable VEU specification bytes, transcribe the activity clauses and tables, reconcile authoritative vectors and obtain independent approval before estimating VEECs.",
    };
  }

  if (program.programCode === "NSW-ESS") {
    const formulaKey = nswFormulaKey(
      program.programCode,
      activity.registryActivityCode,
    );
    if (
      NSW_EXECUTABLE_ACTIVITY_CODES.has(activity.registryActivityCode)
      || NSW_FORMULA_READY_REGISTRY_REQUIRED_CODES.has(
        activity.registryActivityCode,
      )
    ) {
      const executable = NSW_EXECUTABLE_ACTIVITY_CODES.has(
        activity.registryActivityCode,
      );
      return {
        activityTemplateId: activity.templateId,
        programCode: program.programCode,
        registryActivityCode: activity.registryActivityCode,
        activityTitle: activity.title,
        catalogueState: activity.catalogueState,
        outcomeClass: program.outcomeClass,
        unit: "ESC",
        state: executable
          ? "estimate_available"
          : "official_registry_required",
        pathway: executable
          ? "deterministic_local_estimate"
          : "official_registry_or_calculator",
        formulaKey,
        ...sourceFields,
        officialReconciliationRequired: true,
        certificateActionEnabled: false,
        operatorMessage: executable
          ? "The 1 July 2026 Rule formula and supported official product feed are connected for an estimate. ACP eligibility and implementation evidence still require reconciliation."
          : "The governed formula is implemented and tested. Calculation stays source-controlled until the current TESSA accepted-product evidence can be ingested and date-locked.",
      };
    }
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "ESC",
      state: "governed_formula_required",
      pathway: "source_pinned_formula",
      formulaKey: `nsw-ess-${activity.registryActivityCode.toLowerCase()}-pending`,
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage:
        "The current ESS Rule, method guide, product status and Accredited Certificate Provider controls must be source-pinned and independently approved before estimating ESCs.",
    };
  }

  if (program.programCode === "NSW-PDRS") {
    const formulaKey = nswFormulaKey(
      program.programCode,
      activity.registryActivityCode,
    );
    if (
      NSW_EXECUTABLE_ACTIVITY_CODES.has(activity.registryActivityCode)
      || NSW_PDRS_FORMULA_READY_REGISTRY_REQUIRED_CODES.has(
        activity.registryActivityCode,
      )
    ) {
      const executable = NSW_EXECUTABLE_ACTIVITY_CODES.has(
        activity.registryActivityCode,
      );
      return {
        activityTemplateId: activity.templateId,
        programCode: program.programCode,
        registryActivityCode: activity.registryActivityCode,
        activityTitle: activity.title,
        catalogueState: activity.catalogueState,
        outcomeClass: program.outcomeClass,
        unit: "PRC",
        state: executable
          ? "estimate_available"
          : "official_registry_required",
        pathway: executable
          ? "deterministic_local_estimate"
          : "official_registry_or_calculator",
        formulaKey,
        ...sourceFields,
        officialReconciliationRequired: true,
        certificateActionEnabled: false,
        operatorMessage: executable
          ? "The 1 July 2026 Rule formula and supported official product feed are connected for an estimate. ACP, network, response and implementation evidence still require reconciliation."
          : "The governed battery formula is implemented and tested. BESS1 to BESS4 require an exact installation-date selection from the CEC Approved Batteries list plus every applicable PDRS Rule requirement. BESS3 and BESS4 also require an exact governed Battery Inverter Output field. BESS5 remains blocked until the Scheme Administrator publishes its recording method.",
      };
    }
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "PRC",
      state: "governed_formula_required",
      pathway: "source_pinned_formula",
      formulaKey: `nsw-pdrs-${activity.registryActivityCode.toLowerCase()}-pending`,
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage:
        "The applicable PDRS method, capacity-holder controls, product status and activity commencement date must be source-pinned and independently approved before estimating PRCs.",
    };
  }

  if (program.programCode === "ACT-EEIS" || program.programCode === "SA-REPS") {
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: program.programCode === "ACT-EEIS" ? "MWh" : "GJ",
      state: "governed_formula_required",
      pathway: "source_pinned_formula",
      formulaKey: `${program.programCode.toLowerCase()}-${activity.registryActivityCode.toLowerCase()}-pending`,
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage:
        "This retailer-obligation activity requires its current official factor and an authorised provider route. It does not create a freely tradable installer certificate.",
    };
  }

  if (program.programCode === "ACCU") {
    return {
      activityTemplateId: activity.templateId,
      programCode: program.programCode,
      registryActivityCode: activity.registryActivityCode,
      activityTitle: activity.title,
      catalogueState: activity.catalogueState,
      outcomeClass: program.outcomeClass,
      unit: "ACCU",
      state: "project_method_required",
      pathway: "project_measurement_and_verification",
      formulaKey: "cer-accu-project-method-required",
      ...sourceFields,
      officialReconciliationRequired: true,
      certificateActionEnabled: false,
      operatorMessage:
        "ACCUs require a registered project, the applicable method, baselines, monitoring, reporting and audit. An installer job alone cannot produce an ACCU quantity.",
    };
  }

  const registryUnits: Record<string, CertificateCalculationUnit> = {
    LRET: "LGC",
    REGO: "REGO",
  };
  return {
    activityTemplateId: activity.templateId,
    programCode: program.programCode,
    registryActivityCode: activity.registryActivityCode,
    activityTitle: activity.title,
    catalogueState: activity.catalogueState,
    outcomeClass: program.outcomeClass,
    unit: registryUnits[program.programCode] || "none",
    state: "official_registry_required",
    pathway: "official_registry_or_calculator",
    formulaKey: `${program.programCode.toLowerCase()}-official-registry-required`,
    ...sourceFields,
    officialReconciliationRequired: true,
    certificateActionEnabled: false,
    operatorMessage:
      "This specialist pathway requires an accredited facility or project and an authorised registry process. TLink does not calculate it from an ordinary installer job.",
  };
}

export const GOVERNMENT_ACTIVITY_CALCULATION_METHODS:
readonly GovernmentActivityCalculationMethod[] =
  GOVERNMENT_ACTIVITY_TEMPLATES.map(methodForActivity);

export function governmentActivityCalculationMethods(programCode: string) {
  return GOVERNMENT_ACTIVITY_CALCULATION_METHODS.filter(
    (method) => method.programCode === programCode,
  );
}

export function governmentCalculationSourceWindows(programCode: string) {
  return GOVERNMENT_CALCULATION_SOURCE_WINDOWS.filter(
    (window) => window.programCode === programCode,
  );
}

export const GOVERNMENT_CALCULATION_METHOD_SUMMARY =
  CERTIFICATE_CALCULATION_STATES.map((state) => ({
    state,
    count: GOVERNMENT_ACTIVITY_CALCULATION_METHODS.filter(
      (method) => method.state === state,
    ).length,
  }));
