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

export const CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES = [
  CREDITEX_GEMS_PRODUCT_REGISTRY,
  CREDITEX_VEU_PRODUCT_REGISTRY,
] as const;

export const CREDITEX_CONTROLLED_MANUAL_PRODUCT_REGISTRIES = [
  CREDITEX_CER_CEC_PRODUCT_REGISTRY,
] as const;

export function creditexAutomaticProductRegistry(registryCode: string) {
  return CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES.find(
    (registry) => registry.registryCode === registryCode,
  );
}
