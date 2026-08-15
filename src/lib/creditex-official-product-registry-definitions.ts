import {
  parseOfficialProductSource,
  type OfficialProductRecord,
} from "./creditex-official-product-parsers.ts";
import {
  CER_CEC_PRODUCT_SOURCES,
  GEMS_PRODUCT_SOURCES,
  type OfficialProductKind,
  type OfficialProductSource,
} from "./creditex-official-product-sources.ts";
import type {
  CreditexOfficialProductKind,
  CreditexOfficialProductRecord,
} from "./creditex-official-product-registry.ts";
import type {
  CreditexOfficialProductRegistryDefinition,
  CreditexOfficialProductSourceDefinition,
} from "./creditex-official-product-registry-server.ts";
import {
  CREDITEX_VEU_PRODUCT_REGISTRY_FETCH,
  CREDITEX_VEU_PRODUCT_SOURCE,
} from "./creditex-veu-product-sources.ts";
import {
  CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
  CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL,
  createCreditexLicensedCecBatteryProductRegistry,
  type CreditexLicensedCecBatteryCredentials,
} from "./creditex-cec-battery-source.ts";
import {
  CREDITEX_TESSA_PRODUCT_REGISTRY,
} from "./creditex-tessa-product-source.ts";
import {
  parseWaSupportedSolutionsSource,
} from "./creditex-wa-product-parsers.ts";
import {
  WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE,
} from "./creditex-wa-product-sources.ts";

export {
  CREDITEX_CEC_BATTERY_ALL_RECORDS_URL,
  CREDITEX_CEC_BATTERY_CURRENT_RECORDS_URL,
  createCreditexLicensedCecBatteryProductRegistry,
  type CreditexLicensedCecBatteryCredentials,
};
export { CREDITEX_TESSA_PRODUCT_REGISTRY };

const PRODUCT_KIND_MAP = {
  solar_pv_module: "pv_module",
  solar_inverter: "inverter",
  solar_battery: "battery",
  air_conditioner: "air_conditioner",
  electric_water_heater: "electric_water_heater",
  gas_water_heater: "gas_water_heater",
  close_control_air_conditioner: "close_control_air_conditioner",
  household_refrigerator_freezer: "refrigerator_freezer",
  television: "television",
  clothes_dryer: "clothes_dryer",
  pool_pump: "pool_pump",
  electric_motor: "electric_motor",
  commercial_refrigerator: "commercial_refrigerator",
  chiller: "chiller",
} as const satisfies Record<OfficialProductKind, CreditexOfficialProductKind>;

function record(
  value: OfficialProductRecord,
): CreditexOfficialProductRecord {
  return {
    sourceKey: value.sourceKey,
    sourceRecordKey: value.sourceRecordKey,
    productKind: PRODUCT_KIND_MAP[value.productKind],
    manufacturer: value.manufacturer || "",
    brand: value.brand || "",
    model: value.model,
    series: value.series || "",
    registrationNumber: value.registrationNumber || "",
    certificateNumber: value.certificateNumber || "",
    approvalStatus: value.approvalStatus,
    eligibleFrom: value.eligibleFrom || "",
    eligibleTo: value.eligibleTo || "",
    availableInAustralia: value.availableInAustralia === true,
    attributes: { ...value.attributes },
  };
}

function source(
  value: OfficialProductSource,
): CreditexOfficialProductSourceDefinition {
  return {
    registryCode: value.registryCode,
    sourceKey: value.sourceKey,
    productKind: PRODUCT_KIND_MAP[value.productKind],
    url: value.url,
    minimumRecords: value.minimumRecords,
    maximumBytes: value.maxBytes,
    expectedContentTypes: value.expectedContentTypes,
    accept: value.format === "csv" ? "text/csv" : "application/json",
    licence: [
      value.licence.status,
      value.licence.identifier,
      value.licence.attribution,
      value.licence.note,
    ].join(" | "),
    productionMode: value.productionMode === "public_official"
        && value.licence.status === "confirmed_open"
      ? "automatic"
      : "controlled_manual",
    parse: (bytes, contentType) => (
      parseOfficialProductSource(value, bytes, contentType).map(record)
    ),
  };
}

export const CREDITEX_CER_CEC_PRODUCT_REGISTRY:
CreditexOfficialProductRegistryDefinition = {
  registryCode: "cer-cec-products",
  title: "CER-hosted CEC approved solar products",
  sources: CER_CEC_PRODUCT_SOURCES.map(source),
};

export const CREDITEX_GEMS_PRODUCT_REGISTRY:
CreditexOfficialProductRegistryDefinition = {
  registryCode: "gems-products",
  title: "GEMS registered appliance and equipment data",
  sources: GEMS_PRODUCT_SOURCES.map(source),
};

export const CREDITEX_VEU_PRODUCT_REGISTRY:
CreditexOfficialProductRegistryDefinition = {
  registryCode: "veu-approved-products",
  title: "Victorian Energy Upgrades public product register",
  sources: [CREDITEX_VEU_PRODUCT_SOURCE],
  fetchSources: CREDITEX_VEU_PRODUCT_REGISTRY_FETCH,
};

const CREDITEX_WA_SYNERGY_PRODUCT_SOURCE:
CreditexOfficialProductSourceDefinition = {
  registryCode: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.registryCode,
  sourceKey: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.sourceKey,
  productKind: "wa_synergy_supported_solution",
  url: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.url,
  minimumRecords: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.minimumRecords,
  maximumBytes: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.maxBytes,
  expectedContentTypes:
    WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.expectedContentTypes,
  accept: "text/html",
  licence: [
    WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.licence.status,
    WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.licence.url,
    WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.licence.note,
  ].join(" | "),
  productionMode: "controlled_manual",
  requiresOfficialEligibleFrom: true,
  parse: (bytes, contentType) => parseWaSupportedSolutionsSource(
    WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE,
    bytes,
    contentType,
  ).map((item) => ({
    sourceKey: item.sourceKey,
    sourceRecordKey: item.sourceRecordKey,
    productKind: "wa_synergy_supported_solution" as const,
    manufacturer: item.manufacturer,
    brand: item.brand,
    model: item.model,
    series: item.series,
    registrationNumber: "",
    certificateNumber: "",
    approvalStatus: "approved",
    eligibleFrom: item.effectiveSnapshotDate,
    eligibleTo: "",
    availableInAustralia: true,
    attributes: {
      ...item.attributes,
      derGeneratorProvisional: item.derGeneratorProvisional,
      derGeneratorFullListing: item.derGeneratorFullListing,
      derStorageProvisional: item.derStorageProvisional,
      derStorageFullListing: item.derStorageFullListing,
      derStorageSupported: item.derStorageSupported,
      derStorageActivationReady: item.derStorageActivationReady,
    },
  })),
};

export const CREDITEX_WA_SYNERGY_PRODUCT_REGISTRY:
CreditexOfficialProductRegistryDefinition = {
  registryCode: WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE.registryCode,
  title: "Synergy supported solutions list",
  sources: [CREDITEX_WA_SYNERGY_PRODUCT_SOURCE],
};

export const CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES = [
  CREDITEX_GEMS_PRODUCT_REGISTRY,
  CREDITEX_TESSA_PRODUCT_REGISTRY,
  CREDITEX_VEU_PRODUCT_REGISTRY,
] as const;

export const CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS = {
  username: "CREDITEX_CEC_BATTERY_API_USERNAME",
  password: "CREDITEX_CEC_BATTERY_API_PASSWORD",
  licenceReference: "CREDITEX_CEC_BATTERY_LICENCE_REFERENCE",
} as const;

export const CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES = [
  CREDITEX_CER_CEC_PRODUCT_REGISTRY,
  CREDITEX_WA_SYNERGY_PRODUCT_REGISTRY,
] as const;

export function creditexControlledManualProductRegistry(
  registryCode: string,
) {
  return CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES.find(
    (registry) => registry.registryCode === registryCode,
  );
}

function cecBatteryConnectorState(
  environment: Readonly<Record<string, unknown>>,
) {
  const credentials = Object.fromEntries(
    Object.entries(CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS).map(([key, name]) => [
      key,
      typeof environment[name] === "string" ? environment[name] : "",
    ]),
  ) as CreditexLicensedCecBatteryCredentials;
  const configured = Object.values(credentials).filter((value) => value !== "");
  if (configured.length === 0) {
    return {
      issue: `The platform CEC battery connector is not configured. Configure ${Object.values(CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS).join(", ")} together.`,
    };
  }
  if (configured.length !== 3) {
    return {
      issue: `The platform CEC battery connector configuration is incomplete. Configure ${Object.values(CREDITEX_CEC_BATTERY_ENVIRONMENT_KEYS).join(", ")} together.`,
    };
  }
  try {
    return {
      definition: createCreditexLicensedCecBatteryProductRegistry(credentials),
    };
  } catch (error) {
    return {
      issue: `The platform CEC battery connector configuration is invalid: ${error instanceof Error ? error.message : "unknown validation error"}`,
    };
  }
}

function licensedCecBatteryRegistryFromEnvironment(
  environment: Readonly<Record<string, unknown>>,
) {
  return cecBatteryConnectorState(environment).definition;
}

export function creditexCecBatteryConnectorConfigurationIssue(
  environment: Readonly<Record<string, unknown>> = {},
) {
  return cecBatteryConnectorState(environment).issue || null;
}

export function creditexAutomaticProductRegistries(
  environment: Readonly<Record<string, unknown>> = {},
) {
  const licensedCecBattery = licensedCecBatteryRegistryFromEnvironment(
    environment,
  );
  return licensedCecBattery
    ? [...CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES, licensedCecBattery]
    : [...CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES];
}

export function creditexAutomaticProductRegistry(
  registryCode: string,
  environment: Readonly<Record<string, unknown>> = {},
) {
  const base = CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES.find(
    (registry) => registry.registryCode === registryCode,
  );
  if (base) return base;
  if (registryCode !== "cec-products") return undefined;
  return licensedCecBatteryRegistryFromEnvironment(environment);
}
