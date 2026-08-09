import {
  CREDITEX_TESSA_PRODUCT_MAXIMUM_BYTES,
  CREDITEX_TESSA_PRODUCT_MINIMUM_RECORDS,
  CREDITEX_TESSA_PRODUCT_REGISTRY_CODE,
  CREDITEX_TESSA_PRODUCT_SOURCE_KEY,
  parseCreditexTessaAcceptedProductCsv,
} from "./creditex-tessa-product-parser.ts";
import type {
  CreditexOfficialProductRegistryDefinition,
} from "./creditex-official-product-registry-server.ts";

export const CREDITEX_TESSA_ACCEPTED_PRODUCTS_PAGE_URL =
  "https://tessa.energysustainabilityschemes.nsw.gov.au/ipart?id=accepted_products" as const;
export const CREDITEX_TESSA_PRODUCT_LIST_INFORMATION_URL =
  "https://www.energysustainabilityschemes.nsw.gov.au/product-lists" as const;

export const CREDITEX_TESSA_WATER_HEATER_EXPORT_FIELDS = [
  "u_accepted_product_id",
  "u_report_product_type",
  "u_methods",
  "u_report_activity_definition",
  "u_effective_from",
  "u_effective_to",
  "u_brand",
  "u_model_number",
  "u_as_nzs4234_version",
  "u_zone_3_system_size",
  "u_zone_3_peak_load_mj_day",
  "u_zone_3_annual_energy_savings",
  "u_zone_3_bs_gj_year",
  "u_zone_3_be_gj_year",
  "u_zone_3_hpelec_gj_year",
  "u_zone_3_hpgas_gj_year",
  "u_zone_3_refelec_gj_year",
  "u_zone_5_system_size",
  "u_zone_5_peak_load_mj_day",
  "u_zone_5_annual_energy_savings",
  "u_zone_5_bs_gj_year",
  "u_zone_5_be_gj_year",
  "u_zone_5_hpelec_gj_year",
  "u_zone_5_hpgas_gj_year",
  "u_zone_5_refelec_gj_year",
  "u_no_of_hot_water_tank_s",
  "u_tank_model_number",
  "u_tank_size_l",
  "u_pre_heat_tank_model_numbers",
  "u_finishing_tank_model_numbers",
  "u_pre_heat_tank_volume_l",
  "u_finishing_tank_volume_l",
  "u_total_system_tank_volume_l",
  "u_collector_type",
  "u_collector_model_number",
  "u_no_of_collectors",
  "u_no_of_heat_pump_s",
  "u_heat_pump_unit_model_numbers",
  "u_total_heat_pump_thermal_capacity_kw",
  "u_system_booster_type",
  "u_booster_model_numbers",
  "u_total_thermal_capacity_kw",
  "u_system_type",
  "u_report_refrigerant_type_gwp",
  "u_refrigerant_charge_kg",
  "u_limitations",
  "u_status",
] as const;

export const CREDITEX_TESSA_WATER_HEATER_EXPORT_QUERY =
  "u_statusINactive,cancelled^u_report_activity_definitionIND17,D18,D19,D20" as const;

export const CREDITEX_TESSA_WATER_HEATER_EXPORT_URL = [
  "https://tessa.energysustainabilityschemes.nsw.gov.au/",
  "sn_customerservice_accepted_products_list.do?CSV",
  `&sysparm_query=${encodeURIComponent(CREDITEX_TESSA_WATER_HEATER_EXPORT_QUERY)}`,
  "&sysparm_view=sp",
  `&sysparm_fields=${encodeURIComponent(CREDITEX_TESSA_WATER_HEATER_EXPORT_FIELDS.join(","))}`,
].join("");

export const CREDITEX_TESSA_PRODUCT_REGISTRY:
CreditexOfficialProductRegistryDefinition = {
  registryCode: CREDITEX_TESSA_PRODUCT_REGISTRY_CODE,
  title: "NSW TESSA accepted D17-D20 water heaters",
  sources: [{
    registryCode: CREDITEX_TESSA_PRODUCT_REGISTRY_CODE,
    sourceKey: CREDITEX_TESSA_PRODUCT_SOURCE_KEY,
    productKinds: [
      "nsw_heat_pump_water_heater",
      "nsw_solar_water_heater",
    ],
    url: CREDITEX_TESSA_WATER_HEATER_EXPORT_URL,
    minimumRecords: CREDITEX_TESSA_PRODUCT_MINIMUM_RECORDS,
    maximumBytes: CREDITEX_TESSA_PRODUCT_MAXIMUM_BYTES,
    expectedContentTypes: ["text/csv"],
    accept: "text/csv",
    licence: [
      "Official public TESSA Accepted Products CSV export",
      "IPART copyright; all rights reserved",
      "retained for source-pinned eligibility verification and not source-artifact redistribution",
      CREDITEX_TESSA_PRODUCT_LIST_INFORMATION_URL,
    ].join(" | "),
    productionMode: "automatic",
    parse: parseCreditexTessaAcceptedProductCsv,
  }],
};
