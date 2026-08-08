export const CREDITEX_OFFICIAL_PRODUCT_SOURCE_CONTRACT =
  "creditex-official-product-sources/v1" as const;

export const CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT =
  "2026-08-08" as const;

export type OfficialProductRegistryCode =
  | "cer-cec-products"
  | "gems-products";

export type OfficialProductKind =
  | "solar_pv_module"
  | "solar_inverter"
  | "solar_battery"
  | "air_conditioner"
  | "electric_water_heater"
  | "gas_water_heater"
  | "close_control_air_conditioner"
  | "household_refrigerator_freezer"
  | "television"
  | "clothes_dryer"
  | "pool_pump"
  | "electric_motor"
  | "commercial_refrigerator"
  | "chiller";

export type OfficialProductSourceFormat = "csv" | "ckan_datastore_json";

export type OfficialProductSourceLicence = Readonly<{
  name: string;
  identifier: string;
  url: string;
  attribution: string;
  status: "confirmed_open" | "permission_required";
  note: string;
}>;

export type OfficialProductSource = Readonly<{
  registryCode: OfficialProductRegistryCode;
  sourceKey: string;
  productKind: OfficialProductKind;
  url: string;
  minimumRecords: number;
  maximumRecords: number;
  maxBytes: number;
  expectedContentTypes: readonly string[];
  licence: OfficialProductSourceLicence;
  productionMode: "public_official" | "controlled_manual";
  format: OfficialProductSourceFormat;
  expectedFields: readonly string[];
  identityFields: readonly string[];
  eligibleFromField: string | null;
  eligibleToField: string | null;
  approvalStatusField: string | null;
  availabilityField: string | null;
  resourceId: string | null;
  verifiedRecordCount: number;
  verifiedUniqueRecordCount: number;
  verifiedAt: typeof CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT;
}>;

export type LicenceRequiredProductConnector = Readonly<{
  connectorKey: string;
  registryCode: "cec-products" | "netcc" | "saa";
  url: string;
  productionMode: "licence_required";
  callable: false;
  licenceUrl: string;
  reason: string;
}>;

const CER_LICENCE: OfficialProductSourceLicence = {
  name: "Third-party CEC content reuse permission unresolved",
  identifier: "PERMISSION-REQUIRED",
  url: "https://cer.gov.au/about-us/our-policies/copyright",
  attribution:
    "Clean Energy Regulator, incorporating source product data attributed by the published artifact.",
  status: "permission_required",
  note:
    "The CER general CC BY 4.0 notice excludes material supplied by third parties. These artifacts reproduce CEC product lists and no explicit commercial republication permission was located.",
};

const GEMS_LICENCE: OfficialProductSourceLicence = {
  name: "Creative Commons Attribution 3.0 Australia",
  identifier: "CC-BY-3.0-AU",
  url: "https://data.gov.au/data/dataset/energy-rating-for-household-appliances",
  attribution:
    "Commonwealth of Australia, Greenhouse and Energy Minimum Standards Regulator.",
  status: "confirmed_open",
  note: "The data.gov.au package declares Creative Commons Attribution 3.0 Australia.",
};

const GEMS_NON_LABELLED_LICENCE: OfficialProductSourceLicence = {
  ...GEMS_LICENCE,
  url: "https://data.gov.au/data/dataset/energy-rating-data-for-household-appliances-non-labelled-products",
};

const CSV_CONTENT_TYPES = ["text/csv"] as const;
const GEMS_CSV_CONTENT_TYPES = ["application/octet-stream", "text/csv"] as const;

const CER_PV_FIELDS = [
  "Licensee/Certificate Holder",
  "Model Number",
  "CEC Approved Date",
  "Expiry Date",
  "Fire Tested",
] as const;

const CER_INVERTER_FIELDS = [
  "Manufacturer",
  "Series",
  "Model Number",
  "AC Power (kW)",
  "Approval Date",
  "Expiry date",
] as const;

const CER_BATTERY_FIELDS = [
  "Manufacturer/Certificate Holder Account",
  "Brand Name",
  "Series",
  "Model Number",
  "Nominal Battery Capacity (kWh)",
  "Usable Capacity (kWh)",
  "CEC Approved Date",
  "CEC Expiry Date",
] as const;

const GEMS_AIR_CONDITIONER_FIELDS = [
  "_id|ApplStandard|MEPSComp|N-Standard|Model_No|Family Name|avg_pwr_standby_mode|Brand|C-Dehumid_Rated|Configuration1|Configuration2|Configuration2-unitmount|Configuration3_Sink|Configuration3_Source|Country|C-Power_Inp_Rated|C-Sens_Cool_Rated|C-Total Cool Rated|Depth|H2_COP|H2_HeatPwrCapacity|H2_HeatPwrInput|Height|H-Power_Inp_Rated|H-Total Heat Rated|indoorType|EERtestAvg|COPtestAvg|Invert|Setting_cool|Setting_heat|Pnoc|Pnoh|VSCP_EER50|VSCP_COP50|eermepslev|TestedOutputEER|TestedOutputCOP|AnnualOutputEER|AnnualOutputCOP|PL_EERMEPS|PL_COPMEPS|sri2010_cool|sri2010_heat|Star2010_Cool|Star2010_Heat|outdoortype|Phase|Refrigerant|Sold_in|Submit_ID|ExpDate|GrandDate|SubmitStatus|Type|Width|Demand Response Capability|Product Class|Demand Response 1|Demand Response 2|Demand Response 4|Demand Response 5|Demand Response 6|Demand Response 7|PartNumber|EER|Availability Status|star2000_cool|star2000_heat|Product Website|Representative Brand URL|Variable Output Compressor|Star Image Large|Star Image Small|Registration Number",
  "Is variable speed|Type variable output|Var output compressor|Variable output rated as fixed sp|No HSPF|Rated Total Cool Capacity W|Rated cooling power input kW|Have T1 half cap results|T1_half_cap_power_rated|T1_half_cap_cooling_cap_rated|Have T1 min cap results|T1_min_cap_power_rated|T1_min_cap_cooling_cap_rated|Have low temp cool full cap results|Low temp cooling full cap power rated|Low temp cooling full cap rated|Have low temp cool half cap results|Low temp cooling half cap power rated|Low temp cooling half cap rated|Have low temp cool min cap results|Low temp cooling min cap power rated|Low temp cooling min cap rated|Rated Heating Capacity watts|Rated heating power input kW|H1_half_cap_power_rated|H1_half_cap_heat_cap_rated|Have H1 min cap results|H1_min_cap_power_rated|H1_min_cap_heat_cap_rated|Have H2 extended mode results|H2_ext_cap_power_rated|H2_ext_cap_heat_cap_rated|Have H2 full mode results|H2_full_cap_power_rated|H2_full_cap_heat_cap_rated|Have H2 half capacity results|H2_half_cap_power_rated|H2_half_cap_heat_cap_rated|Have H2 min capacity results|H2_min_cap_power_rated|H2_min_cap_heat_cap_rated|Have H3 extended mode results|H3_ext_cap_power_rated|H3_ext_cap_heat_cap_rated|Have H3 full mode results|H3_full_cap_power_rated|H3_full_cap_heat_cap_rated|Have H3 half capacity results|H3_half_cap_power_rated|H3_half_cap_heat_cap_rated|indoor_sound_level|outdoor_sound_level",
  "Residential TCSPF_cold|Residential TCSPF_mixed|Residential TCSPF_hot|Commercial TCSPF_cold|Commercial TCSPF_mixed|Commercial TCSPF_hot|Residential tcec_cold|Residential tcec_mixed|Residential tcec_hot|Commercial tcec_cold|Commercial tcec_mixed|Commercial tcec_hot|c_star_cold|c_star_mixed|c_star_hot|Residential HSPF_cold|Residential HSPF_mixed|Residential HSPF_hot|Commercial HSPF_cold|Commercial HSPF_mixed|Commercial HSPF_hot|Residential thec_cold|Residential thec_mixed|Residential thec_hot|Commercial thec_cold|Commercial thec_mixed|Commercial thec_hot|h_star_cold|h_star_mixed|h_star_hot|Outdoor unit only|Have_water_tank|Rated cool power input with water|Rated cool cap with water W|Rated cool cap with water kW|Residential tcec_cold with water|Residential tcec_mixed with water|Residential tcec_hot with water|PIA inoperative power|Rated AEER|Rated ACOP",
].join("|").split("|");

const GEMS_ELECTRIC_WATER_HEATER_FIELDS =
  "_id|adjust_temp|ApplStandard|Brand|Cap|Country|Decl Stand Heat|Depth|Gross Store Cap|Heating Elements|Height|Label-MEPSNZ|Model No|Family Name|N-Standard|N-Standard_MEPS|Sold_in|Submit_ID|SubmitStatus|tot_expan_valves|tot_feed_tanks|tot_hotwat_fittings|TPR Valves|Type|vent_displacement|Width|ExpDate|GrandDate|Product Class|Availability Status|Product Website|Representative Brand URL|Registration Number"
    .split("|");

const GEMS_GAS_WATER_HEATER_FIELDS =
  "_id|Submit_ID|SubmitStatus|Sold_in|Brand|Model Number|Family Name|Country|N-Standard|ApplStandard|Width|Height|Depth|Product Class|Availability Status|Product Website|Representative Brand URL|Expiry Date|Suitable for Gas Types|Nominal Gas Consumption (MJ/Hour)|Nominal Delivery output (x Litres per min. @ 45AdegC rise)|Comparative Annual Energy Consumption (MJ/Year)|Suitable for Solar boosting|Storage Capacity (Litres)|Water Heater Type|Registration Number"
    .split("|");

const GEMS_CLOSE_CONTROL_AIR_CONDITIONER_FIELDS =
  "_id|Submit_ID|SubmitStatus|Sold_in|Brand|Model Number|Family Name|Country|N-Standard|ApplStandard|Width|Height|Depth|Product Class|EER|Rated Power Input|Cooling Capacity|Availability Status|Product Website|Representative Brand URL|Expiry Date|Variable output compressor|Registration Number"
    .split("|");

const GEMS_HOUSEHOLD_REFRIGERATOR_FREEZER_FIELDS =
  "_id|Adaptive Defrost|ApplStandard|Brand|Labelled energy consumption (kWh/year)|CompartGrVol|CompartNetVol|CompartType|Configuration|Country|Depth|Designation|FF Vol|FZ Vol|Group|Height|Icemaker|MEPSApproval|Model No|Family Name|N-Standard|Star2009|SRI2009|No_Doors|S-MEPS_Ad|S-MEPScutoff|Sold_in|Submit_ID|SubmitStatus|Tot Vol|Width|ExpDate|GrandDate|Product Class|Availability Status|Product Website|Representative Brand URL|Fixed MEPS allowance factor|Variable MEPS allowance factor|Adjusted volume|Type|Star Rating (old)|Star Image Large|Star Image Small|Registration Number|Defrost_System_Controller"
    .split("|");

const GEMS_TELEVISION_FIELDS =
  "_id|Submit_ID|Brand_Reg|Model_No|Family Name|SoldIn|Country|screensize|Screen_Area|Screen_Tech|Pasv_stnd_power|Act_stnd_power|Act_stnd_time|Avg_mode_power|Star|SRI|Labelled energy consumption (kWh/year)|SubmitStatus|ExpDate|GrandDate|Product Class|Availability Status|Star2|Product Website|Representative Brand URL|Star Rating Index|Star Image Large|Star Image Small|Power supply|Tuner Type|What test standard was used|Registration Number|Regulatory Standard"
    .split("|");

const GEMS_CLOTHES_DRYER_FIELDS =
  "_id|ApplStandard|Brand|Cap|Combination|Control|Country|Depth|Height|Model No|Family Name|N-Standard|Labelled energy consumption (kWh/year)|New SRI|New Star|Prog Name|Prog Time|Sold_in|SubmitStatus|Submit_ID|Test_Moist_Remove|Tot_Wat_Cons|Registration Number|Type|Record ID|Width|ExpDate|GrandDate|Product Class|Availability Status|Product Website|Representative Brand URL|Star Rating (old)|Star Image Large|Star Image Small"
    .split("|");

const GEMS_POOL_PUMP_FIELDS =
  "_id|Brand|Model|Product Website|Available|Pool Pump Type|Nameplate Input Power|Input Power|Current|High|Low|Star Rating Index|Star Rating|Weighted Energy Factor|Daily Run Time|Labelled energy consumption (kWh/year)|Date Available Until|Star Image Large|Star Image Small|Registration Number|Record ID"
    .split("|");

const GEMS_ELECTRIC_MOTOR_FIELDS =
  "_id|ApplStandard|Brand|Country Of Manufacturer|Eff50|Eff75|EffFL|Enclr|Frame|High_eff_compl|High_eff_load|kWatt|MEPS_Applic|MEPS_compl_load|MEPS_Why|Model No|Family Name|Mount_Code|N-Standard|N-TestMethod|NumPls|Sold_in|Submit_ID|SubmitStatus|Torque_FL|Voltage|Weight|ExpDate|GrandDate|Product Class|Availability Status|Product Website|Representative Brand URL|Registration Number"
    .split("|");

const GEMS_COMMERCIAL_REFRIGERATOR_FIELDS =
  "_id|ApplStandard|Brand|climate_class|Country|high_efficiency|Model No|Family Name|N-Standard|Sold_in|Submit_ID|SubmitStatus|Temp_Class|total_dis_area|total_energy_cons|type|ExpDate|GrandDate|Product Class|Availability Status|Product Website|Representative Brand URL|Type|Efficiency (kWh/24h/m2)|Length|Climate Class|Climate Class For Energy Consumption Test|Climate Class For M-package Temperature Test|Climate Class For Duty Type|Depth|Cabinet Description|Total Energy Consumption(kWh/24h)|Cabinet Type|Star Rating|Energy Efficiency Index|Width|Net Volume|Height|Duty Type|Product Class Number|Registration Number"
    .split("|");

const GEMS_CHILLER_FIELDS =
  "_id|Submit_ID|Brand_Reg|Model_No|Family Name|SoldIn|Country|Sing_or_fam|standard_rating|condenser_type|cert_program|cooling_capacity|Decl_COP|Decl_IPLV|ExpDate|GrandDate|SubmitStatus|Product Class|Availability Status|Product Website|Representative Brand URL|Registration Basis|Registration Number"
    .split("|");

export const CER_CEC_PRODUCT_SOURCES: readonly OfficialProductSource[] = [
  {
    registryCode: "cer-cec-products",
    sourceKey: "cer-cec-approved-pv-modules",
    productKind: "solar_pv_module",
    url: "https://cer.gov.au/document/cec-approved-pv-modules-0",
    minimumRecords: 4_000,
    maximumRecords: 20_000,
    maxBytes: 2_000_000,
    expectedContentTypes: CSV_CONTENT_TYPES,
    licence: CER_LICENCE,
    productionMode: "controlled_manual",
    format: "csv",
    expectedFields: CER_PV_FIELDS,
    identityFields: [
      "Licensee/Certificate Holder",
      "Model Number",
      "CEC Approved Date",
      "Expiry Date",
    ],
    eligibleFromField: "CEC Approved Date",
    eligibleToField: "Expiry Date",
    approvalStatusField: null,
    availabilityField: null,
    resourceId: null,
    verifiedRecordCount: 4_526,
    verifiedUniqueRecordCount: 4_526,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "cer-cec-products",
    sourceKey: "cer-cec-approved-inverters",
    productKind: "solar_inverter",
    url: "https://cer.gov.au/document/cec-approved-inverters-0",
    minimumRecords: 4_200,
    maximumRecords: 20_000,
    maxBytes: 2_000_000,
    expectedContentTypes: CSV_CONTENT_TYPES,
    licence: CER_LICENCE,
    productionMode: "controlled_manual",
    format: "csv",
    expectedFields: CER_INVERTER_FIELDS,
    identityFields: [
      "Manufacturer",
      "Series",
      "Model Number",
      "Approval Date",
      "Expiry date",
    ],
    eligibleFromField: "Approval Date",
    eligibleToField: "Expiry date",
    approvalStatusField: null,
    availabilityField: null,
    resourceId: null,
    verifiedRecordCount: 4_666,
    verifiedUniqueRecordCount: 4_666,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "cer-cec-products",
    sourceKey: "cer-cec-approved-solar-batteries",
    productKind: "solar_battery",
    url: "https://cer.gov.au/document/cec-approved-solar-batteries-0",
    minimumRecords: 3_200,
    maximumRecords: 20_000,
    maxBytes: 2_000_000,
    expectedContentTypes: CSV_CONTENT_TYPES,
    licence: CER_LICENCE,
    productionMode: "controlled_manual",
    format: "csv",
    expectedFields: CER_BATTERY_FIELDS,
    identityFields: [
      "Manufacturer/Certificate Holder Account",
      "Brand Name",
      "Series",
      "Model Number",
      "CEC Approved Date",
      "CEC Expiry Date",
    ],
    eligibleFromField: "CEC Approved Date",
    eligibleToField: "CEC Expiry Date",
    approvalStatusField: null,
    availabilityField: null,
    resourceId: null,
    verifiedRecordCount: 3_509,
    verifiedUniqueRecordCount: 3_509,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
] as const;

export const GEMS_PRODUCT_SOURCES: readonly OfficialProductSource[] = [
  {
    registryCode: "gems-products",
    sourceKey: "gems-air-conditioners",
    productKind: "air_conditioner",
    url: "https://data.gov.au/data/datastore/dump/0973a476-eb0c-45e6-9a18-054f74307843?format=csv",
    minimumRecords: 5_500,
    maximumRecords: 10_000,
    maxBytes: 8_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_AIR_CONDITIONER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model_No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "0973a476-eb0c-45e6-9a18-054f74307843",
    verifiedRecordCount: 6_000,
    verifiedUniqueRecordCount: 5_979,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-electric-water-heaters",
    productKind: "electric_water_heater",
    url: "https://data.gov.au/data/datastore/dump/46159b27-455a-42e7-a619-49c13fbab6e0?format=csv",
    minimumRecords: 1_300,
    maximumRecords: 5_000,
    maxBytes: 4_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_ELECTRIC_WATER_HEATER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "46159b27-455a-42e7-a619-49c13fbab6e0",
    verifiedRecordCount: 1_485,
    verifiedUniqueRecordCount: 1_485,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-gas-water-heaters",
    productKind: "gas_water_heater",
    url: "https://data.gov.au/data/datastore/dump/a47fa7f3-57b8-4476-8067-1ded596b076a?format=csv",
    minimumRecords: 600,
    maximumRecords: 3_000,
    maxBytes: 2_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_GAS_WATER_HEATER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model Number"],
    eligibleFromField: null,
    eligibleToField: "Expiry Date",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "a47fa7f3-57b8-4476-8067-1ded596b076a",
    verifiedRecordCount: 677,
    verifiedUniqueRecordCount: 677,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-close-control-air-conditioners",
    productKind: "close_control_air_conditioner",
    url: "https://data.gov.au/data/datastore/dump/ad6a568e-34bc-43a1-97d9-5e9c3ed0b131?format=csv",
    minimumRecords: 300,
    maximumRecords: 2_000,
    maxBytes: 1_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_CLOSE_CONTROL_AIR_CONDITIONER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model Number"],
    eligibleFromField: null,
    eligibleToField: "Expiry Date",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "ad6a568e-34bc-43a1-97d9-5e9c3ed0b131",
    verifiedRecordCount: 335,
    verifiedUniqueRecordCount: 335,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-household-refrigerators-freezers",
    productKind: "household_refrigerator_freezer",
    url: "https://data.gov.au/data/datastore/dump/0eabca18-49bb-4a9e-8019-28d5d56501c4?format=csv",
    minimumRecords: 3_600,
    maximumRecords: 10_000,
    maxBytes: 4_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_HOUSEHOLD_REFRIGERATOR_FREEZER_FIELDS,
    identityFields: ["Submit_ID", "Brand", "Model No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "0eabca18-49bb-4a9e-8019-28d5d56501c4",
    verifiedRecordCount: 3_945,
    verifiedUniqueRecordCount: 3_943,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-televisions",
    productKind: "television",
    url: "https://data.gov.au/data/datastore/dump/93a615e5-935e-4713-a4b0-379e3f6dedc9?format=csv",
    minimumRecords: 4_500,
    maximumRecords: 10_000,
    maxBytes: 4_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_TELEVISION_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand_Reg", "Model_No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "93a615e5-935e-4713-a4b0-379e3f6dedc9",
    verifiedRecordCount: 4_979,
    verifiedUniqueRecordCount: 4_979,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-clothes-dryers",
    productKind: "clothes_dryer",
    url: "https://data.gov.au/data/datastore/dump/f734c56b-a255-4c4e-a3c1-e835c38b8774?format=csv",
    minimumRecords: 800,
    maximumRecords: 5_000,
    maxBytes: 2_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_CLOTHES_DRYER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "f734c56b-a255-4c4e-a3c1-e835c38b8774",
    verifiedRecordCount: 883,
    verifiedUniqueRecordCount: 881,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-swimming-pool-pumps",
    productKind: "pool_pump",
    url: "https://data.gov.au/data/datastore/dump/17dc8af6-91c8-4e90-bb22-d9a49612b2bf?format=csv",
    minimumRecords: 600,
    maximumRecords: 5_000,
    maxBytes: 1_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_POOL_PUMP_FIELDS,
    identityFields: ["Record ID", "Registration Number", "Brand", "Model"],
    eligibleFromField: null,
    eligibleToField: "Date Available Until",
    approvalStatusField: null,
    availabilityField: "Available",
    resourceId: "17dc8af6-91c8-4e90-bb22-d9a49612b2bf",
    verifiedRecordCount: 662,
    verifiedUniqueRecordCount: 662,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-electric-motors",
    productKind: "electric_motor",
    url: "https://data.gov.au/data/datastore/dump/20f7b969-e48a-44d8-963b-9a9edc42a8b8?format=csv",
    minimumRecords: 4_400,
    maximumRecords: 10_000,
    maxBytes: 4_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_NON_LABELLED_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_ELECTRIC_MOTOR_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "20f7b969-e48a-44d8-963b-9a9edc42a8b8",
    verifiedRecordCount: 4_793,
    verifiedUniqueRecordCount: 4_793,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-commercial-refrigerators",
    productKind: "commercial_refrigerator",
    url: "https://data.gov.au/data/datastore/dump/82aaca00-6e7e-48da-a7e1-89de7ab90fdb?format=csv",
    minimumRecords: 7_000,
    maximumRecords: 10_000,
    maxBytes: 5_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_NON_LABELLED_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_COMMERCIAL_REFRIGERATOR_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand", "Model No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "82aaca00-6e7e-48da-a7e1-89de7ab90fdb",
    verifiedRecordCount: 7_500,
    verifiedUniqueRecordCount: 7_500,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
  {
    registryCode: "gems-products",
    sourceKey: "gems-chillers",
    productKind: "chiller",
    url: "https://data.gov.au/data/datastore/dump/c0fc95a1-51c3-4009-8ecf-eaf2ba8358de?format=csv",
    minimumRecords: 160,
    maximumRecords: 2_000,
    maxBytes: 1_000_000,
    expectedContentTypes: GEMS_CSV_CONTENT_TYPES,
    licence: GEMS_NON_LABELLED_LICENCE,
    productionMode: "public_official",
    format: "csv",
    expectedFields: GEMS_CHILLER_FIELDS,
    identityFields: ["Submit_ID", "Registration Number", "Brand_Reg", "Model_No"],
    eligibleFromField: "GrandDate",
    eligibleToField: "ExpDate",
    approvalStatusField: "SubmitStatus",
    availabilityField: "Availability Status",
    resourceId: "c0fc95a1-51c3-4009-8ecf-eaf2ba8358de",
    verifiedRecordCount: 184,
    verifiedUniqueRecordCount: 184,
    verifiedAt: CREDITEX_OFFICIAL_PRODUCT_SOURCES_VERIFIED_AT,
  },
] as const;

export const OFFICIAL_PRODUCT_SOURCES: readonly OfficialProductSource[] = [
  ...CER_CEC_PRODUCT_SOURCES,
  ...GEMS_PRODUCT_SOURCES,
] as const;

export const LICENCE_REQUIRED_PRODUCT_CONNECTORS:
  readonly LicenceRequiredProductConnector[] = [
    {
      connectorKey: "cec-live-products-api",
      registryCode: "cec-products",
      url: "https://cleanenergycouncil.org.au/industry-programs/data",
      productionMode: "licence_required",
      callable: false,
      licenceUrl: "https://cleanenergycouncil.org.au/industry-programs/data",
      reason:
        "CEC product API access and redistribution require a CEC data licence and credentials.",
    },
    {
      connectorKey: "cec-product-suspensions-and-delistings",
      registryCode: "cec-products",
      url: "https://cleanenergycouncil.org.au/industry-programs/products-program/product-delistings",
      productionMode: "licence_required",
      callable: false,
      licenceUrl: "https://cleanenergycouncil.org.au/legal",
      reason:
        "The public page is authoritative for review, but automated commercial copying is not licensed by the public site terms.",
    },
    {
      connectorKey: "netcc-approved-seller-directory",
      registryCode: "netcc",
      url: "https://www.newenergytech.org.au/find-an-approved-seller",
      productionMode: "licence_required",
      callable: false,
      licenceUrl: "https://cleanenergycouncil.org.au/industry-programs/data",
      reason:
        "NETCC directory data is included in the CEC third-party data licence and has no public bulk contract.",
    },
    {
      connectorKey: "saa-accreditation-status",
      registryCode: "saa",
      url: "https://saaustralia.com.au/accreditation-status-check/",
      productionMode: "licence_required",
      callable: false,
      licenceUrl: "https://saaustralia.com.au/terms/",
      reason:
        "The public checker is an interactive point check, not a licensed bulk registry API.",
    },
  ] as const;
