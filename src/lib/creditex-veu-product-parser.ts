import type {
  CreditexOfficialProductKind,
  CreditexOfficialProductRecord,
} from "./creditex-official-product-registry.ts";
import type {
  CreditexOfficialProductStreamingParser,
  CreditexOfficialProductStreamValue,
} from "./creditex-official-product-registry-server.ts";

export const CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT =
  "creditex-veu-public-registry-powerbi/v2" as const;
export const CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT =
  "creditex-veu-public-registry-powerbi-ndjson/v3" as const;
export const CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT =
  "creditex-veu-public-registry-powerbi-ndjson/v4" as const;
export const CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY =
  "veu-public-product-register" as const;
export const CREDITEX_VEU_REPORT_ID =
  "8fd064b2-c06c-44f0-8d9d-d7c5804fcd1f" as const;
export const CREDITEX_VEU_DATASET_ID =
  "93dfde74-9213-4c52-ac47-5b3aec919ce2" as const;
export const CREDITEX_VEU_MODEL_ID = 664626 as const;

export const CREDITEX_VEU_QUERY_FIELDS = [
  "Id",
  "Product_ID__c",
  "Legacy_Product_Id__c",
  "Product_Category_Number__c",
  "Activity_Type__c",
  "Brand__c",
  "Model__c",
  "Product_Status__c",
  "Effective_From__c",
  "Effective_To__c",
  "Total_Volume_L__c",
  "Star_Rating__c",
  "CEC_kWhy__c",
  "Screen_Area_cm2__c",
  "Rated_Capacity_kg__c",
  "GEMS_Determination_Version__c",
  "WERS_Star_Rating_heating__c",
] as const;

export const CREDITEX_VEU_QUERY_FIELD_TYPES = [
  1, 1, 1, 1, 1, 1, 1, 1, 7, 7, 3, 3, 3, 3, 3, 1,
  3,
] as const;

export const CREDITEX_VEU_DIM_PRODUCT_SCHEMA = {
  Id: [1, "e37e1b71-ed9f-4bb6-be83-e01a242eb1ec"],
  Product_ID__c: [1, "abdbbbb7-1f25-4934-8f45-c4b05ef4ae8f"],
  Legacy_Product_Id__c: [1, "86dc38f2-f7d2-4e97-9dc8-9fd5492e77a5"],
  Product_Category_Number__c: [1, "bda8dd10-fef9-47b9-b025-2309f91d9a26"],
  Activity_Type__c: [1, "448d260b-ba3a-455d-bdcc-4438eb8b67fa"],
  Brand__c: [1, "4c017803-7827-4364-ac57-2d7d3b9d83c2"],
  Model__c: [1, "d7a98a5b-086c-457e-920a-deb0742dcdd5"],
  Product_Status__c: [1, "35c26c7a-d828-4874-b2ee-ad459f7e26e2"],
  Effective_From__c: [7, "be68ccda-83b9-4c0d-857d-3f6e4a526973"],
  Effective_To__c: [7, "85690fb6-9651-4ea2-b514-735fd88307ba"],
  Total_Volume_L__c: [3, "6a05df4d-7b68-4868-9639-d677a5afeacb"],
  Star_Rating__c: [3, "c477438d-2ba3-466a-a200-864f0a503516"],
  CEC_kWhy__c: [3, "5b226f5e-c4c1-4c60-90ff-b2fc0b400267"],
  Screen_Area_cm2__c: [3, "cce5fc68-3017-4c5f-be63-61f9107eadde"],
  Rated_Capacity_kg__c: [3, "53190516-dbbb-4214-8032-fcdfde4b3ad6"],
  GEMS_Determination_Version__c: [1, "2b026ecc-7b76-4cc1-9041-c993ca0208ea"],
  System_Size__c: [1, "b08f76f6-5d54-4a17-9307-3675583abe31"],
  Zone_4_Bs_GJyear_system_load_size__c: [3, "2c7c67be-b031-49f1-b293-1a469508b835"],
  Zone_4_Be_GJyear_system_load_size__c: [3, "4012ff62-80df-4217-87a0-71496caa19f3"],
  Zone_5_Bs_GJyear_system_load_size__c: [3, "4f9b18f0-8c04-4b7a-896b-88d39064d0df"],
  Zone_5_Be_GJyear_system_load_size__c: [3, "1977d390-4ad6-4508-b177-19f3ee387a09"],
  Zone_4_Bs_GJyear_step_down_load_size__c: [3, "71a98d92-5469-4aad-acbb-a0c90d8f2b01"],
  Zone_4_Be_GJyear_step_down_load_size__c: [3, "d7293c8d-cf5b-4518-921c-f8bac8e09974"],
  Zone_5_Bs_GJyear_step_down_load_size__c: [3, "fdf6747f-6f64-44e2-b325-86b0794c2bb6"],
  Zone_5_Be_GJyear_step_down_load_size__c: [3, "8dfa528b-3f05-4fca-91d5-ee10578350e6"],
  Zone_4_Annual_Energy_Savings_system_l__c: [3, "d1483d38-74ea-4603-a276-346be86400c1"],
  Zone_5_Annual_Energy_Savings_system_l__c: [3, "c2e266c0-7bcd-4ddc-a1ad-807949e73392"],
  Product_Configuration__c: [1, "cfeb1e77-d3b7-483e-8d9c-eefd5430859b"],
  Heating_Capacity_kW__c: [3, "a439cd20-43b5-4293-8a88-fbf3abbf4046"],
  Cooling_Capacity_kW__c: [3, "843792b4-44e6-401f-902a-3adfb1e25f5b"],
  ACOP__c: [3, "b29e5ce6-e9bc-4fb1-9ec8-c73704e765ac"],
  AEER__c: [3, "c45ceacd-a95c-4dce-a6c5-0b9677e32fe3"],
  GEMS_HSPF_Cold_res__c: [3, "47d5791b-1536-4580-9fa5-ca68502e7e23"],
  GEMS_TCSPF_Cold_res__c: [3, "d6af83ae-d6af-415f-842f-838c2d4c28b6"],
  GEMS_HSPF_Mixed_res__c: [3, "a31c588a-524c-44f7-a6f5-d353d397a8e4"],
  GEMS_TCSPF_Mixed_res__c: [3, "c660a34a-77a2-44ae-8ab1-d161a172ac55"],
  GEMS_HSPF_Cold_com__c: [3, "f1705bbd-c80d-4fec-8241-053caa78bbc5"],
  GEMS_TCSPF_Cold_com__c: [3, "7206b62d-85af-4b1d-925a-6d9c7938e1a4"],
  GEMS_HSPF_Mixed_com__c: [3, "abdb02d3-8534-4b5c-9753-0c1584d9be05"],
  GEMS_TCSPF_Mixed_com__c: [3, "ea92befc-6d12-4240-b188-34d5b3e6fc49"],
  GEMS_Class__c: [1, "3878c08d-2115-4cef-b067-83203ebc5b0b"],
  GEMS_Registered_Before_2_August_2024__c: [5, "24c300a6-3974-4d5f-9435-76eb9cb6d108"],
  Calculated_HSPF_Cold_res__c: [3, "0281f9f0-b982-4f51-988e-7e29e90c261b"],
  Calculated_TCSPF_Cold_res__c: [3, "adeb3e94-27c9-46e1-9b33-0894143d1148"],
  Calculated_HSPF_Mixed_res__c: [3, "e45350f1-9929-47bf-8983-862e74c3fb93"],
  Calculated_TCSPF_Mixed_res__c: [3, "649a3158-526b-436b-92ec-e9740b634c8a"],
  Calculated_HSPF_Cold_com__c: [3, "1d6e49d5-3d79-427c-9538-2cb90aae9716"],
  Calculated_TCSPF_Cold_com__c: [3, "9fe88fe4-42e2-4c15-a37a-cc1692e9fa65"],
  Calculated_HSPF_Mixed_com__c: [3, "9222ae30-972e-4435-8281-27e8286304cd"],
  Calculated_TCSPF_Mixed_com__c: [3, "6e9a4ca8-2c26-413d-9256-a02400c19092"],
  Refrigerant_Type_GWP__c: [1, "18505e89-36de-428b-b95b-db7bd3686738"],
  Refrigerant_Charge_kg__c: [3, "58977f22-d210-4c61-b790-22293448139d"],
  WERS_Star_Rating_heating__c: [3, "3f9f29c5-5ccf-4e15-8dc3-8ed84a1bda7b"],
  Product_Type__c: [1, "ecc73565-6b4b-4345-b895-6d7caf0a5f95"],
  Warranty_Period_Years__c: [3, "54d4f2a7-7b61-48f1-a6a5-b61a23a0aa0a"],
  PAEC_kWhy__c: [3, "a149c6f7-8755-4a93-b7c3-1925c92c83d3"],
  Type__c: [1, "6c27a201-6df1-4346-b2ce-d74b1d0aade0"],
  LCP_W__c: [3, "ddbb263b-f309-4cd4-83e1-997830413e03"],
  LCPVictorian_Load_W__c: [3, "4884efc2-7a93-45ec-b730-0b0bb07c77fb"],
  Total_LCP_W__c: [3, "375f2c4b-3d4a-4545-be85-e1aaf1a199b2"],
  NLP_W__c: [3, "e94f34f0-1ffc-47e8-aec8-25c0600ed437"],
  Nominal_Device_Rating_W__c: [3, "23f94647-3405-4931-b491-3eecda7bcf7b"],
  RatedLifetime__c: [1, "0d561c71-6509-4f8b-bfe6-d808d7c1a335"],
  VRU_Voltage__c: [3, "e876b127-5281-42bc-997a-c6d3fbde8550"],
  Occupancy_Sensor__c: [5, "4a30b2f7-e37b-4095-936f-dd2608289596"],
  Programmable_Dimmer__c: [5, "bf93372f-77dc-42d1-9779-81a7627c826c"],
  Manual_Dimmer__c: [5, "51e77db8-a627-40cf-a1ef-a957f28a4671"],
  DayLight_Linked_Control__c: [5, "0ff07682-9dd4-47f6-9b9b-65169907e269"],
  Voltage_Reduction_Unit__c: [5, "af49749b-8a15-4742-9abe-c9459730619e"],
  Power_Factor__c: [3, "da3bb27e-c4d0-4d3d-a938-e61735dbcf75"],
  Input_Power_W__c: [3, "739c57a7-8d75-4ba8-a784-e72f340750a3"],
  Output_Power_W__c: [3, "b2a1d192-58ff-44fb-abfd-44a221622a96"],
  Reported_Lifetime_L70__c: [3, "a4038372-15d9-4cc2-bb11-ef23ade5e45f"],
  No_of_Lamps__c: [3, "36aefab7-09cb-496d-8371-7fa52da5f38e"],
  Efficacy__c: [1, "1bbccdc1-5154-4085-963f-6ed50c68d0e3"],
  Product_Class__c: [1, "0eb64265-0a28-4e1b-8211-c234126737e7"],
  Characteristic_Code__c: [1, "bd113437-3966-4292-823d-1156c5d67324"],
  Energy_Efficiency_Index__c: [3, "26bec47b-dcf2-4ad6-b9d4-4bbe0149f999"],
  Total_Display_Area_m2__c: [3, "0abc87f4-28c3-4df7-bcb0-6ab2cff1e883"],
  Total_Energy_Consumption_kWh24h__c: [3, "d87854d2-c7e8-49fb-809d-792867009a4a"],
  Net_Volume_L__c: [3, "0cd3b63f-0d05-4958-a69a-3928d83940ca"],
  Duty_Type__c: [1, "6f0d3441-316d-4bfd-833f-96f1d1f56130"],
  Rotor_Motor_Type__c: [1, "76a4568b-3c45-4b7f-89ea-e701f18892c4"],
  Product_Application__c: [1, "2b637ea1-b3f0-43bf-8833-b397e27f9df9"],
  Number_of_Heat_Pumps__c: [3, "69a6a888-eb37-4a8a-a6b2-0e3774d6de28"],
  Number_of_Tanks__c: [3, "fdf6449f-2398-4a9e-aa26-4e9db23b4abd"],
  Total_Heat_Pump_Thermal_Capacity_kW__c: [3, "4b4f3c0c-17aa-4456-b464-cdbeb43896ed"],
  Total_Thermal_Capacity_kW__c: [3, "1cb20e80-c5c3-47be-b3ba-229d059abb23"],
  Thermal_Capacity_kW__c: [3, "b419fec6-3a08-43e8-a4e8-200b0b7bdd27"],
  Total_System_Tank_Volume_L__c: [3, "b9a278dc-0504-4655-9bc6-7c2eab3b82e9"],
  Storage_Capacity_L__c: [3, "10863a6f-cdd7-4aca-9bbf-ee6304994c04"],
  Zone_4_Annual_Energy_Savings__c: [3, "5a54bb7c-66d9-46e7-a04c-e20577cb9c23"],
  Zone_4_HPelec_GLyear__c: [3, "24909217-f9b4-4bb9-8bdc-24a0f131b9d2"],
  Zone_4_HPgas_GJyear__c: [3, "423a2c11-17af-4722-b194-1c3a34bb4a77"],
  Zone_4_Peak_Load_MJday__c: [3, "fd76b7ee-973a-4081-bf1e-42879036c5ea"],
  Zone_5_Annual_Energy_Savings__c: [3, "7ef298db-eca9-404e-b3ef-e651445e95b0"],
  Zone_5_HPelec_GLyear__c: [3, "441b3b31-cdaa-4e94-b87f-db7b20dd8d32"],
  Zone_5_HPgas_GJyear__c: [3, "283a2b07-f979-4785-8cc0-9dfe2addebad"],
  Zone_5_Peak_Load_MJday__c: [3, "4ddbce1f-0cea-46d2-b7a7-22d223460ff7"],
  R_Value__c: [3, "fdcb16c4-b63b-494b-b89a-126475d39f5e"],
  Winter_R_Value__c: [1, "d1091a8c-ee2d-4906-ae08-15b7fa57b760"],
  Area_sqm__c: [3, "bfb26364-5238-4af2-919e-6cea31d5532f"],
  Width_mm__c: [3, "2e482bc2-445f-45ef-b054-8dd4d96c7edc"],
  Depth_mm__c: [3, "8e3dd825-0a80-4d14-b62d-46ee06ca18b3"],
} as const;

/**
 * Power BI's numeric transport is binary floating point, while the VEU
 * semantic model declares the regulator-facing decimal format.  Keep the
 * format contract separate from the identity contract above so a format
 * change is reviewed instead of silently changing certificate arithmetic.
 * A null value means the semantic model deliberately exposes no decimal
 * format. Those fields use the separate, live-audited source-decimal bound
 * below: the official value is retained without rounding, and a wider future
 * precision fails closed for contract review.
 */
export const CREDITEX_VEU_NUMERIC_FORMATS = {
  Total_Volume_L__c: null,
  Star_Rating__c: "0.0",
  CEC_kWhy__c: "0",
  Screen_Area_cm2__c: null,
  Rated_Capacity_kg__c: null,
  Zone_4_Bs_GJyear_system_load_size__c: "0.0000",
  Zone_4_Be_GJyear_system_load_size__c: "0.0000",
  Zone_5_Bs_GJyear_system_load_size__c: "0.0000",
  Zone_5_Be_GJyear_system_load_size__c: "0.0000",
  Zone_4_Bs_GJyear_step_down_load_size__c: "0.0000",
  Zone_4_Be_GJyear_step_down_load_size__c: "0.0000",
  Zone_5_Bs_GJyear_step_down_load_size__c: "0.0000",
  Zone_5_Be_GJyear_step_down_load_size__c: "0.0000",
  Zone_4_Annual_Energy_Savings_system_l__c: "0.0000",
  Zone_5_Annual_Energy_Savings_system_l__c: "0.0000",
  Heating_Capacity_kW__c: "0.0000",
  Cooling_Capacity_kW__c: "0.0000",
  ACOP__c: "0.0000",
  AEER__c: "0.0000",
  GEMS_HSPF_Cold_res__c: "0.0000",
  GEMS_TCSPF_Cold_res__c: "0.0000",
  GEMS_HSPF_Mixed_res__c: "0.0000",
  GEMS_TCSPF_Mixed_res__c: "0.0000",
  GEMS_HSPF_Cold_com__c: "0.0000",
  GEMS_TCSPF_Cold_com__c: "0.0000",
  GEMS_HSPF_Mixed_com__c: "0.0000",
  GEMS_TCSPF_Mixed_com__c: "0.0000",
  Calculated_HSPF_Cold_res__c: "0.0000",
  Calculated_TCSPF_Cold_res__c: "0.0000",
  Calculated_HSPF_Mixed_res__c: "0.0000",
  Calculated_TCSPF_Mixed_res__c: "0.0000",
  Calculated_HSPF_Cold_com__c: "0.0000",
  Calculated_TCSPF_Cold_com__c: "0.0000",
  Calculated_HSPF_Mixed_com__c: "0.0000",
  Calculated_TCSPF_Mixed_com__c: "0.0000",
  Refrigerant_Charge_kg__c: "0.0000",
  WERS_Star_Rating_heating__c: "0.0000",
  Warranty_Period_Years__c: null,
  PAEC_kWhy__c: "0.0000",
  LCP_W__c: "0.0000",
  LCPVictorian_Load_W__c: "0.0000",
  Total_LCP_W__c: "0.0000",
  NLP_W__c: "0.0000",
  Nominal_Device_Rating_W__c: "0.0000",
  VRU_Voltage__c: null,
  Power_Factor__c: "0.0000",
  Input_Power_W__c: "0.0000",
  Output_Power_W__c: "0.0000",
  Reported_Lifetime_L70__c: null,
  No_of_Lamps__c: "0",
  Energy_Efficiency_Index__c: "0.0000",
  Total_Display_Area_m2__c: "0.0000",
  Total_Energy_Consumption_kWh24h__c: "0.0000",
  Net_Volume_L__c: "0.0000",
  Number_of_Heat_Pumps__c: "0",
  Number_of_Tanks__c: "0",
  Total_Heat_Pump_Thermal_Capacity_kW__c: "0.0000",
  Total_Thermal_Capacity_kW__c: "0.0000",
  Thermal_Capacity_kW__c: "0.0000",
  Total_System_Tank_Volume_L__c: "0.0000",
  Storage_Capacity_L__c: "0.0000",
  Zone_4_Annual_Energy_Savings__c: "0.0000",
  Zone_4_HPelec_GLyear__c: "0.0000",
  Zone_4_HPgas_GJyear__c: "0.0000",
  Zone_4_Peak_Load_MJday__c: "0.0000",
  Zone_5_Annual_Energy_Savings__c: "0.0000",
  Zone_5_HPelec_GLyear__c: "0.0000",
  Zone_5_HPgas_GJyear__c: "0.0000",
  Zone_5_Peak_Load_MJday__c: "0.0000",
  R_Value__c: "0.0000",
  Area_sqm__c: "0.0000",
  Width_mm__c: "0.0000",
  Depth_mm__c: "0.0000",
} as const satisfies Readonly<Record<string, string | null>>;

const CREDITEX_VEU_UNFORMATTED_DECIMAL_PLACES = {
  Total_Volume_L__c: 0,
  Screen_Area_cm2__c: 2,
  Rated_Capacity_kg__c: 0,
  Warranty_Period_Years__c: 0,
  VRU_Voltage__c: 0,
  Reported_Lifetime_L70__c: 0,
} as const satisfies Readonly<Record<string, number>>;

const CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS = [
  "Id",
  "Product_ID__c",
  "Product_Category_Number__c",
  "Product_Status__c",
] as const;

export const CREDITEX_VEU_SUPPLEMENTAL_QUERIES = [
  {
    key: "water-heater-model",
    categories: ["1C", "1D", "3C", "3D"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "System_Size__c",
      "Zone_4_Bs_GJyear_system_load_size__c",
      "Zone_4_Be_GJyear_system_load_size__c",
      "Zone_5_Bs_GJyear_system_load_size__c",
      "Zone_5_Be_GJyear_system_load_size__c",
      "Zone_4_Bs_GJyear_step_down_load_size__c",
      "Zone_4_Be_GJyear_step_down_load_size__c",
      "Zone_5_Bs_GJyear_step_down_load_size__c",
      "Zone_5_Be_GJyear_step_down_load_size__c",
      "Zone_4_Annual_Energy_Savings_system_l__c",
      "Zone_5_Annual_Energy_Savings_system_l__c",
    ],
  },
  {
    key: "air-conditioner-performance",
    categories: [
      "6A", "6B(i)", "6B(ii)", "6C", "6D", "6E(i)", "6E(ii)",
      "6F", "6G",
    ],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Product_Configuration__c",
      "Product_Type__c",
      "Heating_Capacity_kW__c",
      "Cooling_Capacity_kW__c",
      "ACOP__c",
      "AEER__c",
      "GEMS_HSPF_Cold_res__c",
      "GEMS_TCSPF_Cold_res__c",
      "GEMS_HSPF_Mixed_res__c",
      "GEMS_TCSPF_Mixed_res__c",
      "GEMS_HSPF_Cold_com__c",
      "GEMS_TCSPF_Cold_com__c",
      "GEMS_HSPF_Mixed_com__c",
      "GEMS_TCSPF_Mixed_com__c",
      "GEMS_Class__c",
      "GEMS_Registered_Before_2_August_2024__c",
      "Calculated_HSPF_Cold_res__c",
      "Calculated_TCSPF_Cold_res__c",
      "Calculated_HSPF_Mixed_res__c",
      "Calculated_TCSPF_Mixed_res__c",
      "Calculated_HSPF_Cold_com__c",
      "Calculated_TCSPF_Cold_com__c",
      "Calculated_HSPF_Mixed_com__c",
      "Calculated_TCSPF_Mixed_com__c",
      "Refrigerant_Type_GWP__c",
      "Refrigerant_Charge_kg__c",
    ],
  },
  {
    key: "envelope-weather-pool",
    categories: [
      "14A", "14B", "15A", "15B", "15C", "15D", "15E", "15F",
      "15G", "15H", "26A",
    ],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Product_Type__c",
      "Warranty_Period_Years__c",
      "PAEC_kWhy__c",
    ],
  },
  {
    key: "lighting",
    categories: ["27A", "27B", "34A", "34B", "34C", "35B"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Type__c",
      "Product_Type__c",
      "LCP_W__c",
      "LCPVictorian_Load_W__c",
      "Total_LCP_W__c",
      "NLP_W__c",
      "Nominal_Device_Rating_W__c",
      "RatedLifetime__c",
      "VRU_Voltage__c",
      "Occupancy_Sensor__c",
      "Programmable_Dimmer__c",
      "Manual_Dimmer__c",
      "DayLight_Linked_Control__c",
      "Voltage_Reduction_Unit__c",
      "Power_Factor__c",
      "Input_Power_W__c",
      "Output_Power_W__c",
      "Reported_Lifetime_L70__c",
      "No_of_Lamps__c",
      "Efficacy__c",
    ],
  },
  {
    key: "project-based-lighting",
    productIds: [
      "000029304", "000029305", "000029306", "000029307", "000029308",
      "000029309", "000029310", "000029311", "000029312", "000029313",
      "000029314", "000029315", "000029316",
    ],
    categories: [""],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Type__c",
      "Product_Type__c",
      "LCP_W__c",
      "LCPVictorian_Load_W__c",
      "Total_LCP_W__c",
      "NLP_W__c",
      "Nominal_Device_Rating_W__c",
      "RatedLifetime__c",
      "VRU_Voltage__c",
      "Occupancy_Sensor__c",
      "Programmable_Dimmer__c",
      "Manual_Dimmer__c",
      "DayLight_Linked_Control__c",
      "Voltage_Reduction_Unit__c",
      "Power_Factor__c",
      "Input_Power_W__c",
      "Output_Power_W__c",
      "Reported_Lifetime_L70__c",
      "No_of_Lamps__c",
      "Efficacy__c",
    ],
  },
  {
    key: "refrigerated-cabinet",
    categories: ["32A"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Product_Class__c",
      "Characteristic_Code__c",
      "Energy_Efficiency_Index__c",
      "Total_Display_Area_m2__c",
      "Total_Energy_Consumption_kWh24h__c",
      "Net_Volume_L__c",
      "Duty_Type__c",
      "GEMS_Class__c",
      "GEMS_Registered_Before_2_August_2024__c",
    ],
  },
  {
    key: "fan-motor",
    categories: ["33A"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Input_Power_W__c",
      "Output_Power_W__c",
      "Rotor_Motor_Type__c",
      "Product_Application__c",
    ],
  },
  {
    key: "commercial-water-heater",
    categories: ["44A"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Number_of_Heat_Pumps__c",
      "Number_of_Tanks__c",
      "Total_Heat_Pump_Thermal_Capacity_kW__c",
      "Total_Thermal_Capacity_kW__c",
      "Thermal_Capacity_kW__c",
      "Total_System_Tank_Volume_L__c",
      "Storage_Capacity_L__c",
      "Zone_4_Annual_Energy_Savings__c",
      "Zone_4_HPelec_GLyear__c",
      "Zone_4_HPgas_GJyear__c",
      "Zone_4_Peak_Load_MJday__c",
      "Zone_5_Annual_Energy_Savings__c",
      "Zone_5_HPelec_GLyear__c",
      "Zone_5_HPgas_GJyear__c",
      "Zone_5_Peak_Load_MJday__c",
      "Refrigerant_Type_GWP__c",
      "Refrigerant_Charge_kg__c",
    ],
  },
  {
    key: "insulation",
    categories: ["12A", "48A", "48B"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "R_Value__c",
      "Winter_R_Value__c",
      "Area_sqm__c",
      "Product_Type__c",
    ],
  },
  {
    key: "induction-cooktop",
    categories: ["46A", "46B"],
    fields: [
      ...CREDITEX_VEU_SUPPLEMENT_IDENTITY_FIELDS,
      "Width_mm__c",
      "Depth_mm__c",
      "Warranty_Period_Years__c",
      "Product_Type__c",
    ],
  },
] as const;

const CREDITEX_VEU_SUPPLEMENT_ATTRIBUTE_KEYS: Readonly<Record<string, string>> = {
  System_Size__c: "veuSystemSize",
  Zone_4_Bs_GJyear_system_load_size__c: "bs2021Zone4SystemLoadGjPerYear",
  Zone_4_Be_GJyear_system_load_size__c: "be2021Zone4SystemLoadGjPerYear",
  Zone_5_Bs_GJyear_system_load_size__c: "bs2021Zone5SystemLoadGjPerYear",
  Zone_5_Be_GJyear_system_load_size__c: "be2021Zone5SystemLoadGjPerYear",
  Zone_4_Bs_GJyear_step_down_load_size__c: "bs2021Zone4StepDownLoadGjPerYear",
  Zone_4_Be_GJyear_step_down_load_size__c: "be2021Zone4StepDownLoadGjPerYear",
  Zone_5_Bs_GJyear_step_down_load_size__c: "bs2021Zone5StepDownLoadGjPerYear",
  Zone_5_Be_GJyear_step_down_load_size__c: "be2021Zone5StepDownLoadGjPerYear",
  Zone_4_Annual_Energy_Savings_system_l__c: "zone4AnnualEnergySavings",
  Zone_5_Annual_Energy_Savings_system_l__c: "zone5AnnualEnergySavings",
  Product_Configuration__c: "veuProductConfiguration",
  Product_Type__c: "veuProductType",
  Heating_Capacity_kW__c: "ratedHeatingCapacityKw",
  Cooling_Capacity_kW__c: "ratedCoolingCapacityKw",
  ACOP__c: "acop",
  AEER__c: "aeer",
  GEMS_HSPF_Cold_res__c: "gemsHspfColdResidential",
  GEMS_TCSPF_Cold_res__c: "gemsTcspfColdResidential",
  GEMS_HSPF_Mixed_res__c: "gemsHspfMixedResidential",
  GEMS_TCSPF_Mixed_res__c: "gemsTcspfMixedResidential",
  GEMS_HSPF_Cold_com__c: "gemsHspfColdCommercial",
  GEMS_TCSPF_Cold_com__c: "gemsTcspfColdCommercial",
  GEMS_HSPF_Mixed_com__c: "gemsHspfMixedCommercial",
  GEMS_TCSPF_Mixed_com__c: "gemsTcspfMixedCommercial",
  GEMS_Class__c: "gemsClass",
  GEMS_Registered_Before_2_August_2024__c:
    "gemsRegisteredBefore2August2024",
  Calculated_HSPF_Cold_res__c: "calculatedHspfColdResidential",
  Calculated_TCSPF_Cold_res__c: "calculatedTcspfColdResidential",
  Calculated_HSPF_Mixed_res__c: "calculatedHspfMixedResidential",
  Calculated_TCSPF_Mixed_res__c: "calculatedTcspfMixedResidential",
  Calculated_HSPF_Cold_com__c: "calculatedHspfColdCommercial",
  Calculated_TCSPF_Cold_com__c: "calculatedTcspfColdCommercial",
  Calculated_HSPF_Mixed_com__c: "calculatedHspfMixedCommercial",
  Calculated_TCSPF_Mixed_com__c: "calculatedTcspfMixedCommercial",
  Refrigerant_Type_GWP__c: "refrigerantType",
  Refrigerant_Charge_kg__c: "refrigerantChargeKg",
  Warranty_Period_Years__c: "warrantyYears",
  PAEC_kWhy__c: "paecKwhPerYear",
  Type__c: "veuType",
  LCP_W__c: "lampCircuitPowerW",
  LCPVictorian_Load_W__c: "victorianLampCircuitPowerW",
  Total_LCP_W__c: "totalLampCircuitPowerW",
  NLP_W__c: "nominalLampPowerW",
  Nominal_Device_Rating_W__c: "nominalDeviceRatingW",
  RatedLifetime__c: "ratedLifetime",
  VRU_Voltage__c: "voltageReductionUnitOutputV",
  Occupancy_Sensor__c: "occupancySensor",
  Programmable_Dimmer__c: "programmableDimmer",
  Manual_Dimmer__c: "manualDimmer",
  DayLight_Linked_Control__c: "daylightLinkedControl",
  Voltage_Reduction_Unit__c: "voltageReductionUnit",
  Power_Factor__c: "powerFactor",
  Input_Power_W__c: "inputPowerW",
  Output_Power_W__c: "outputPowerW",
  Reported_Lifetime_L70__c: "reportedLifetimeL70Hours",
  No_of_Lamps__c: "numberOfLamps",
  Efficacy__c: "efficacy",
  Product_Class__c: "productClass",
  Characteristic_Code__c: "characteristicCode",
  Energy_Efficiency_Index__c: "energyEfficiencyIndex",
  Total_Display_Area_m2__c: "totalDisplayAreaM2",
  Total_Energy_Consumption_kWh24h__c: "totalEnergyConsumptionKwhPer24h",
  Net_Volume_L__c: "netVolumeLitres",
  Duty_Type__c: "dutyType",
  Rotor_Motor_Type__c: "rotorMotorType",
  Product_Application__c: "productApplication",
  Number_of_Heat_Pumps__c: "numberOfHeatPumps",
  Number_of_Tanks__c: "numberOfTanks",
  Total_Heat_Pump_Thermal_Capacity_kW__c: "totalHeatPumpThermalCapacityKw",
  Total_Thermal_Capacity_kW__c: "totalThermalCapacityKw",
  Thermal_Capacity_kW__c: "thermalCapacityKw",
  Total_System_Tank_Volume_L__c: "totalSystemTankVolumeLitres",
  Storage_Capacity_L__c: "storageCapacityLitres",
  Zone_4_Annual_Energy_Savings__c: "zone4AnnualEnergySavings",
  Zone_4_HPelec_GLyear__c: "zone4HpElectricityGjPerYear",
  Zone_4_HPgas_GJyear__c: "zone4HpGasGjPerYear",
  Zone_4_Peak_Load_MJday__c: "zone4CommercialPeakLoadMjPerDay",
  Zone_5_Annual_Energy_Savings__c: "zone5AnnualEnergySavings",
  Zone_5_HPelec_GLyear__c: "zone5HpElectricityGjPerYear",
  Zone_5_HPgas_GJyear__c: "zone5HpGasGjPerYear",
  Zone_5_Peak_Load_MJday__c: "zone5CommercialPeakLoadMjPerDay",
  R_Value__c: "rValue",
  Winter_R_Value__c: "winterRValue",
  Area_sqm__c: "areaSquareMetres",
  Width_mm__c: "widthMm",
  Depth_mm__c: "depthMm",
};

export const CREDITEX_VEU_REFRESH_SCHEMA = {
  entity: "LastRefreshedDateTime",
  property: "Last Refreshed DateTime",
  dataType: 1,
  stableName: "ad391055-c6df-4830-a2b0-6262f65e668e",
} as const;

export const CREDITEX_VEU_CATEGORY_PRODUCT_KIND = {
  "1C": "veu_water_heater",
  "1D": "veu_water_heater",
  "3C": "veu_water_heater",
  "3D": "veu_water_heater",
  "6A": "veu_air_conditioner",
  "6B(i)": "veu_air_conditioner",
  "6B(ii)": "veu_air_conditioner",
  "6C": "veu_air_conditioner",
  "6D": "veu_air_conditioner",
  "6E(i)": "veu_air_conditioner",
  "6E(ii)": "veu_air_conditioner",
  "6F": "veu_air_conditioner",
  "6G": "veu_air_conditioner",
  "12A": "veu_unclassified_product",
  "13A": "veu_double_glazing",
  "14A": "veu_secondary_glazing",
  "14B": "veu_secondary_glazing",
  "15A": "veu_weather_sealing",
  "15B": "veu_weather_sealing",
  "15C": "veu_weather_sealing",
  "15D": "veu_weather_sealing",
  "15E": "veu_weather_sealing",
  "15F": "veu_weather_sealing",
  "15G": "veu_weather_sealing",
  "15H": "veu_weather_sealing",
  "17A": "veu_shower_rose",
  "22A": "veu_refrigerator_freezer_listing",
  "22B": "veu_refrigerator_freezer_listing",
  "22C": "veu_refrigerator_freezer_listing",
  "22D": "veu_refrigerator_freezer_listing",
  "24A": "veu_television_listing",
  "25A": "veu_clothes_dryer_listing",
  "26A": "veu_pool_pump",
  "27A": "veu_activity_27_product",
  "27B": "veu_activity_27_product",
  "30A": "veu_in_home_display",
  "30B": "veu_in_home_display",
  "32A": "veu_refrigerated_display_cabinet",
  "33A": "veu_activity_33_product",
  "34A": "veu_commercial_lighting",
  "34B": "veu_commercial_lighting",
  "34C": "veu_commercial_lighting",
  "35B": "veu_activity_35_product",
  "36A": "veu_activity_36_product",
  "44A": "veu_commercial_water_heater",
  "46A": "veu_induction_cooktop",
  "46B": "veu_induction_cooktop",
  "48A": "veu_ceiling_insulation",
  "48B": "veu_ceiling_insulation",
} as const satisfies Record<string, CreditexOfficialProductKind>;

export const CREDITEX_VEU_PRODUCT_KINDS = [
  ...new Set<CreditexOfficialProductKind>([
    ...Object.values(CREDITEX_VEU_CATEGORY_PRODUCT_KIND),
    "veu_project_based_lighting_product",
    "veu_unclassified_product",
  ]),
] as const;

const CREDITEX_VEU_PROJECT_BASED_LIGHTING_PRODUCT_IDS = new Set([
  "000029304",
  "000029305",
  "000029306",
  "000029307",
  "000029308",
  "000029309",
  "000029310",
  "000029311",
  "000029312",
  "000029313",
  "000029314",
  "000029315",
  "000029316",
]);
const CREDITEX_VEU_PROJECT_BASED_LIGHTING_ACTIVITY_TYPE_ID =
  "a0MW2000000vbXXMAY";
const CREDITEX_VEU_PROJECT_BASED_LIGHTING_LEGACY_SUFFIX =
  "PBA lighting products";

type JsonObject = Record<string, unknown>;
type VeuQueryValue = string | number | boolean | null;
type VeuDecodedPage = Readonly<{
  rows: readonly (readonly VeuQueryValue[])[];
  continuation: boolean;
  restartRow: readonly VeuQueryValue[] | null;
}>;

export type CreditexVeuProductArtifact = Readonly<{
  contract: typeof CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT;
  sourceKey: typeof CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY;
  reportId: typeof CREDITEX_VEU_REPORT_ID;
  datasetId: typeof CREDITEX_VEU_DATASET_ID;
  modelId: typeof CREDITEX_VEU_MODEL_ID;
  sourceRefreshedAt: string;
  queryFields: readonly string[];
  controls: Readonly<{
    total: number;
    statuses: Readonly<Record<string, number>>;
    categories: Readonly<Record<string, number>>;
    modelResponse: string;
    conceptualSchemaResponse: string;
    totalResponse: string;
    statusResponse: string;
    categoryResponse: string;
    refreshResponse: string;
  }>;
  pages: readonly Readonly<{
    afterId: string | null;
    response: string;
  }>[];
  supplements: readonly Readonly<{
    key: string;
    queryFields: readonly string[];
    expectedCount: number;
    pages: readonly Readonly<{
      afterId: string | null;
      response: string;
    }>[];
  }>[];
}>;

function sourceError(message: string): never {
  throw new Error(`VEU public registry source invalid: ${message}`);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return sourceError(`${label} is not valid JSON`);
  }
}

function requiredObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) return sourceError(`${label} is not an object`);
  return value;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return sourceError(`${label} is not an array`);
  return value;
}

function requiredText(value: unknown, label: string, maximum = 10_000) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
  ) {
    return sourceError(`${label} is not bounded text`);
  }
  return value;
}

function count(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return sourceError(`${label} is not a non-negative safe integer`);
  }
  return Number(value);
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const controlled = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(controlled)) {
    return sourceError(`${label} fields changed`);
  }
}

export function validateCreditexVeuPowerBiModel(rawModelResponse: string) {
  const modelDocument = requiredObject(
    parseJson(rawModelResponse, "Power BI model response"),
    "Power BI model response",
  );
  const models = requiredArray(modelDocument.models, "Power BI models");
  if (models.length !== 1) return sourceError("Power BI model count changed");
  const model = requiredObject(models[0], "Power BI model");
  if (
    model.id !== CREDITEX_VEU_MODEL_ID
    || model.dbName !== CREDITEX_VEU_DATASET_ID
  ) {
    return sourceError("Power BI model identity changed");
  }
  const exploration = requiredObject(
    modelDocument.exploration,
    "Power BI exploration",
  );
  const report = requiredObject(exploration.report, "Power BI report");
  const reportModel = requiredObject(report.model, "Power BI report model");
  if (
    report.objectId !== CREDITEX_VEU_REPORT_ID
    || report.modelId !== CREDITEX_VEU_MODEL_ID
    || reportModel.id !== CREDITEX_VEU_MODEL_ID
    || reportModel.dbName !== CREDITEX_VEU_DATASET_ID
  ) {
    return sourceError("Power BI report binding changed");
  }
  return true;
}

export function validateCreditexVeuPowerBiSchema(rawSchemaResponse: string) {
  const schemaDocument = requiredObject(
    parseJson(rawSchemaResponse, "Power BI schema response"),
    "Power BI schema response",
  );
  const schemas = requiredArray(schemaDocument.schemas, "Power BI schemas");
  if (schemas.length !== 1) return sourceError("Power BI schema count changed");
  const schemaResult = requiredObject(schemas[0], "Power BI schema result");
  if (
    schemaResult.modelId !== CREDITEX_VEU_MODEL_ID
    || schemaResult.error !== null
  ) {
    return sourceError("Power BI schema identity changed");
  }
  const schema = requiredObject(schemaResult.schema, "Power BI schema");
  const entities = requiredArray(schema.Entities, "Power BI entities");
  const productEntities = entities.filter((entity) => (
    isObject(entity) && entity.Name === "Dim_Product"
  ));
  if (productEntities.length !== 1) {
    return sourceError("Dim_Product entity identity changed");
  }
  const productEntity = requiredObject(productEntities[0], "Dim_Product entity");
  const properties = requiredArray(
    productEntity.Properties,
    "Dim_Product properties",
  );
  const numericSchemaFields = Object.entries(CREDITEX_VEU_DIM_PRODUCT_SCHEMA)
    .filter(([, [dataType]]) => dataType === 3)
    .map(([name]) => name)
    .sort();
  if (
    JSON.stringify(numericSchemaFields)
    !== JSON.stringify(Object.keys(CREDITEX_VEU_NUMERIC_FORMATS).sort())
  ) {
    return sourceError("controlled numeric-format schema is incomplete");
  }
  const unformattedNumericFields = Object.entries(CREDITEX_VEU_NUMERIC_FORMATS)
    .filter(([, format]) => format === null)
    .map(([name]) => name)
    .sort();
  if (
    JSON.stringify(unformattedNumericFields)
    !== JSON.stringify(
      Object.keys(CREDITEX_VEU_UNFORMATTED_DECIMAL_PLACES).sort(),
    )
  ) {
    return sourceError("controlled source-decimal schema is incomplete");
  }
  for (const [name, [dataType, stableName]] of Object.entries(
    CREDITEX_VEU_DIM_PRODUCT_SCHEMA,
  )) {
    const matches = properties.filter((property) => (
      isObject(property) && property.Name === name
    ));
    if (matches.length !== 1) {
      return sourceError(`Dim_Product property ${name} identity changed`);
    }
    const property = requiredObject(matches[0], `Dim_Product property ${name}`);
    if (property.DataType !== dataType || property.StableName !== stableName) {
      return sourceError(
        `Dim_Product property ${name} schema changed `
        + `(type ${String(property.DataType)}, stable name ${String(property.StableName)})`,
      );
    }
    if (dataType === 3) {
      const expectedFormat = CREDITEX_VEU_NUMERIC_FORMATS[
        name as keyof typeof CREDITEX_VEU_NUMERIC_FORMATS
      ];
      const actualFormat = property.FormatString ?? null;
      if (actualFormat !== expectedFormat) {
        return sourceError(
          `Dim_Product property ${name} numeric format changed `
          + `(expected ${String(expectedFormat)}, received ${String(actualFormat)})`,
        );
      }
    }
  }
  const refreshEntities = entities.filter((entity) => (
    isObject(entity) && entity.Name === CREDITEX_VEU_REFRESH_SCHEMA.entity
  ));
  if (refreshEntities.length !== 1) {
    return sourceError("refresh entity identity changed");
  }
  const refreshEntity = requiredObject(refreshEntities[0], "refresh entity");
  const refreshProperties = requiredArray(
    refreshEntity.Properties,
    "refresh properties",
  );
  const refreshMatches = refreshProperties.filter((property) => (
    isObject(property) && property.Name === CREDITEX_VEU_REFRESH_SCHEMA.property
  ));
  if (refreshMatches.length !== 1) {
    return sourceError("refresh property identity changed");
  }
  const refreshProperty = requiredObject(refreshMatches[0], "refresh property");
  if (
    refreshProperty.DataType !== CREDITEX_VEU_REFRESH_SCHEMA.dataType
    || refreshProperty.StableName !== CREDITEX_VEU_REFRESH_SCHEMA.stableName
  ) {
    return sourceError("refresh property schema changed");
  }
  return true;
}

export function validateCreditexVeuPowerBiModelAndSchema(
  rawModelResponse: string,
  rawSchemaResponse: string,
) {
  validateCreditexVeuPowerBiModel(rawModelResponse);
  validateCreditexVeuPowerBiSchema(rawSchemaResponse);
  return true;
}

function responseDataset(
  rawResponse: string,
  expectedNames: readonly string[],
) {
  const response = requiredObject(parseJson(rawResponse, "query response"), "query response");
  const results = requiredArray(response.results, "query response results");
  if (results.length !== 1) return sourceError("query response result count changed");
  const result = requiredObject(results[0], "query result");
  const jobResult = requiredObject(result.result, "query job result");
  const data = requiredObject(jobResult.data, "query result data");
  const descriptor = requiredObject(data.descriptor, "query descriptor");
  const select = requiredArray(descriptor.Select, "query descriptor Select");
  const names = select.map((item, index) => {
    const property = requiredObject(item, `query projection ${index + 1}`);
    return requiredText(property.Name, `query projection ${index + 1} Name`, 200);
  });
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    return sourceError("query projection schema changed");
  }
  const dsr = requiredObject(data.dsr, "query DSR");
  const datasets = requiredArray(dsr.DS, "query datasets");
  if (datasets.length !== 1) return sourceError("query dataset count changed");
  return requiredObject(datasets[0], "query dataset");
}

function responseDsr(rawResponse: string, queryFields: readonly string[]) {
  return responseDataset(
    rawResponse,
    queryFields.map((field) => `Dim_Product.${field}`),
  );
}

function mask(value: unknown, label: string) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return sourceError(`${label} is not a safe bit mask`);
  }
  return Number(value);
}

function maskIncludes(value: number, index: number) {
  return Math.floor(value / (2 ** index)) % 2 === 1;
}

function normalizedDate(value: unknown, label: string): string {
  const date = typeof value === "number"
    ? new Date(value)
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    return sourceError(`${label} is not a date`);
  }
  const iso = date.toISOString();
  if (!iso.endsWith("T00:00:00.000Z")) {
    return sourceError(`${label} is not an exact regulator date`);
  }
  return iso.slice(0, 10);
}

function positiveZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function canonicalSemanticNumber(
  value: number,
  fieldName: string,
  label: string,
) {
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    return sourceError(`${label} is outside the exact numeric range`);
  }
  if (!Object.hasOwn(CREDITEX_VEU_NUMERIC_FORMATS, fieldName)) {
    return sourceError(`${label} has no controlled numeric format`);
  }
  const format = CREDITEX_VEU_NUMERIC_FORMATS[
    fieldName as keyof typeof CREDITEX_VEU_NUMERIC_FORMATS
  ];
  if (format === null) {
    const decimalPlaces = CREDITEX_VEU_UNFORMATTED_DECIMAL_PLACES[
      fieldName as keyof typeof CREDITEX_VEU_UNFORMATTED_DECIMAL_PLACES
    ];
    if (decimalPlaces === undefined) {
      return sourceError(`${label} has no controlled source-decimal contract`);
    }
    const sourceDecimal = String(value);
    const match = /^-?\d+(?:\.(\d+))?$/.exec(sourceDecimal);
    if (!match || (match[1]?.length || 0) > decimalPlaces) {
      return sourceError(
        `${label} exceeds its reviewed unformatted decimal precision `
        + `(${JSON.stringify(value)})`,
      );
    }
    return positiveZero(value);
  }
  const decimalMatch = /^0(?:\.(0+))?$/.exec(format);
  if (!decimalMatch) {
    return sourceError(`${label} has an unsupported regulator numeric format`);
  }
  const decimalPlaces = decimalMatch[1]?.length || 0;
  if (Math.abs(value) >= 1e21) {
    return sourceError(`${label} is outside the controlled decimal range`);
  }
  return positiveZero(Number(value.toFixed(decimalPlaces)));
}

function normalizedCell(
  value: unknown,
  type: number,
  label: string,
  fieldName: string,
): VeuQueryValue {
  if (value === null) return null;
  if (type === 1) {
    if (typeof value !== "string") return sourceError(`${label} is not text`);
    return value;
  }
  if (type === 3) {
    const numeric = typeof value === "number"
      ? value
      : typeof value === "string"
        && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
        ? Number(value)
        : Number.NaN;
    if (!Number.isFinite(numeric)) {
      return sourceError(
        `${label} is not a finite number (${JSON.stringify(value)})`,
      );
    }
    return canonicalSemanticNumber(numeric, fieldName, label);
  }
  if (type === 5) {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === "0") return false;
    if (value === 1 || value === "1") return true;
    return sourceError(`${label} is not a boolean (${JSON.stringify(value)})`);
  }
  if (type === 7) return normalizedDate(value, label);
  return sourceError(`${label} has an unsupported Power BI type`);
}

function dictionaryValue(
  dataset: JsonObject,
  dictionaryName: string,
  value: unknown,
  label: string,
) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return value;
  const dictionaries = requiredObject(dataset.ValueDicts, "query dictionaries");
  const dictionary = requiredArray(
    dictionaries[dictionaryName],
    `query dictionary ${dictionaryName}`,
  );
  const resolved = dictionary[Number(value)];
  if (resolved === undefined) {
    return sourceError(`${label} has an out-of-range dictionary index`);
  }
  return resolved;
}

function parsePowerBiLiteral(
  value: unknown,
  type: number,
  label: string,
  fieldName: string,
) {
  if (value === null) return null;
  if (type === 5 && (value === true || value === 1)) return true;
  if (type === 5 && (value === false || value === 0)) return false;
  if (typeof value !== "string") {
    return sourceError(`${label} is not a Power BI literal`);
  }
  if (value === "null") return null;
  if (type === 1) {
    const match = /^'([\s\S]*)'$/.exec(value);
    if (!match) return sourceError(`${label} is not a text literal`);
    return match[1].replace(/''/g, "'");
  }
  if (type === 3) {
    const numeric = /^(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:[Dd])?$/.test(value)
      ? Number(value.replace(/[Dd]$/, ""))
      : Number.NaN;
    if (!Number.isFinite(numeric)) {
      return sourceError(`${label} is not a numeric literal`);
    }
    return canonicalSemanticNumber(numeric, fieldName, label);
  }
  if (type === 5) {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return sourceError(`${label} is not a boolean literal`);
  }
  if (type === 7) {
    const match = /^datetime'(.*)'$/.exec(value);
    if (!match) return sourceError(`${label} is not a datetime literal`);
    return normalizedDate(`${match[1]}Z`, label);
  }
  return sourceError(`${label} has an unsupported literal type`);
}

export function decodeCreditexVeuPowerBiProductPage(
  rawResponse: string,
  queryFields: readonly string[] = CREDITEX_VEU_QUERY_FIELDS,
  queryFieldTypes: readonly number[] = CREDITEX_VEU_QUERY_FIELD_TYPES,
  pageWindowRows = 30_000,
): VeuDecodedPage {
  if (
    queryFields.length < 1
    || queryFields.length > 53
    || queryFieldTypes.length !== queryFields.length
    || !Number.isSafeInteger(pageWindowRows)
    || pageWindowRows < 1
    || pageWindowRows > 30_000
  ) {
    return sourceError("product query definition is outside the safe mask width");
  }
  const dataset = responseDsr(rawResponse, queryFields);
  const phases = requiredArray(dataset.PH, "query phases");
  if (phases.length !== 1) return sourceError("product query phase count changed");
  const phase = requiredObject(phases[0], "product query phase");
  const compressedRows = requiredArray(phase.DM0, "product query rows");
  if (compressedRows.length < 1 || compressedRows.length > 30_000) {
    return sourceError("product query row count is outside the controlled window");
  }
  let metadata: readonly JsonObject[] | null = null;
  let previous: readonly VeuQueryValue[] | null = null;
  const decodedRows: VeuQueryValue[][] = [];
  compressedRows.forEach((rawRow, rowIndex) => {
    const row = requiredObject(rawRow, `product row ${rowIndex + 1}`);
    if (rowIndex === 0) {
      const schema = requiredArray(row.S, "product row schema");
      if (schema.length !== queryFields.length) {
        return sourceError("product row schema width changed");
      }
      metadata = schema.map((item, columnIndex) => {
        const field = requiredObject(item, `product field ${columnIndex + 1}`);
        if (
          field.N !== `G${columnIndex}`
          || field.T !== queryFieldTypes[columnIndex]
          || (
            field.DN !== undefined
            && (typeof field.DN !== "string" || !/^D\d+$/.test(field.DN))
          )
        ) {
          return sourceError(`product field ${columnIndex + 1} schema changed`);
        }
        return field;
      });
    } else if (row.S !== undefined) {
      return sourceError("product row schema repeated unexpectedly");
    }
    if (!metadata) return sourceError("product row schema is unavailable");
    const cells = row.C === undefined
      ? []
      : requiredArray(row.C, `product row ${rowIndex + 1} cells`);
    const repeatMask = mask(row.R, `product row ${rowIndex + 1} repeat mask`);
    const nullMask = mask(row["Ø"], `product row ${rowIndex + 1} null mask`);
    let consumed = 0;
    const decoded: VeuQueryValue[] = [];
    metadata.forEach((field, columnIndex) => {
      const repeated = maskIncludes(repeatMask, columnIndex);
      const absent = maskIncludes(nullMask, columnIndex);
      if (repeated && absent) {
        return sourceError(`product row ${rowIndex + 1} has conflicting masks`);
      }
      if (repeated) {
        if (!previous) {
          return sourceError("first product row repeats an unavailable value");
        }
        decoded.push(previous[columnIndex]);
        return;
      }
      if (absent) {
        decoded.push(null);
        return;
      }
      if (consumed >= cells.length) {
        return sourceError(`product row ${rowIndex + 1} is missing a cell`);
      }
      const dictionaryName = typeof field.DN === "string" ? field.DN : "";
      const rawValue = dictionaryName
        ? dictionaryValue(
            dataset,
            dictionaryName,
            cells[consumed],
            `product row ${rowIndex + 1} column ${columnIndex + 1}`,
          )
        : cells[consumed];
      consumed += 1;
      decoded.push(normalizedCell(
        rawValue,
        Number(field.T),
        `product row ${rowIndex + 1} column ${columnIndex + 1}`,
        queryFields[columnIndex],
      ));
    });
    if (consumed !== cells.length) {
      return sourceError(`product row ${rowIndex + 1} has unused cells`);
    }
    decodedRows.push(decoded);
    previous = decoded;
  });
  const continuation = dataset.IC;
  if (typeof continuation !== "boolean") {
    return sourceError("product query continuation flag changed");
  }
  const rawRestart = dataset.RT;
  if (!continuation) {
    const restartRows = requiredArray(rawRestart, "product query restart token");
    if (restartRows.length !== 1) {
      return sourceError("product query restart token count changed");
    }
    const restart = requiredArray(restartRows[0], "product query restart row");
    if (restart.length !== queryFields.length) {
      return sourceError("product query restart width changed");
    }
    const normalizedRestart = restart.map((literal, index) => (
      parsePowerBiLiteral(
        literal,
        queryFieldTypes[index],
        `product restart column ${index + 1}`,
        queryFields[index],
      )
    ));
    if (
      JSON.stringify(normalizedRestart)
      !== JSON.stringify(decodedRows.at(-1))
    ) {
      return sourceError("product query restart row does not match the last row");
    }
    if (decodedRows.length !== pageWindowRows) {
      return sourceError("continuing product query did not fill its window");
    }
    return {
      rows: decodedRows,
      continuation: true,
      restartRow: normalizedRestart,
    };
  }
  if (rawRestart !== undefined && rawRestart !== null) {
    return sourceError("terminal product query returned a restart token");
  }
  if (decodedRows.length === pageWindowRows) {
    return sourceError("terminal product query unexpectedly filled its window");
  }
  return { rows: decodedRows, continuation: false, restartRow: null };
}

export function decodeCreditexVeuPowerBiAggregateCount(
  rawResponse: string,
) {
  const dataset = responseDataset(rawResponse, ["Count_Product_ID"]);
  const phases = requiredArray(dataset.PH, "aggregate query phases");
  if (phases.length !== 1 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("aggregate query shape changed");
  }
  const phase = requiredObject(phases[0], "aggregate query phase");
  const rows = requiredArray(phase.DM0, "aggregate query rows");
  if (rows.length !== 1) return sourceError("aggregate query row count changed");
  const row = requiredObject(rows[0], "aggregate query row");
  const schema = requiredArray(row.S, "aggregate query schema");
  if (
    schema.length !== 1
    || !isObject(schema[0])
    || schema[0].N !== "M0"
    || schema[0].T !== 4
  ) {
    return sourceError("aggregate query schema changed");
  }
  return count(row.M0, "aggregate query count");
}

export function decodeCreditexVeuPowerBiGroupedCounts(
  rawResponse: string,
  property: "Product_Status__c" | "Product_Category_Number__c",
) {
  const dataset = responseDataset(rawResponse, [
    `Dim_Product.${property}`,
    "Count_Product_ID",
  ]);
  const phases = requiredArray(dataset.PH, "grouped query phases");
  if (phases.length !== 2 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("grouped query shape changed");
  }
  const grandPhase = requiredObject(phases[0], "grouped grand-total phase");
  const grandRows = requiredArray(grandPhase.DM0, "grouped grand-total rows");
  if (grandRows.length !== 1) {
    return sourceError("grouped grand-total row count changed");
  }
  const grandRow = requiredObject(grandRows[0], "grouped grand-total row");
  const grandSchema = requiredArray(grandRow.S, "grouped grand-total schema");
  if (
    grandSchema.length !== 1
    || !isObject(grandSchema[0])
    || grandSchema[0].N !== "A0"
    || grandSchema[0].T !== 4
  ) {
    return sourceError("grouped grand-total schema changed");
  }
  const grandTotal = count(grandRow.A0, "grouped grand total");
  const groupPhase = requiredObject(phases[1], "grouped value phase");
  const rows = requiredArray(groupPhase.DM1, "grouped value rows");
  if (rows.length < 1 || rows.length > 200) {
    return sourceError("grouped value row count is outside the controlled bound");
  }
  let metadata: readonly JsonObject[] | null = null;
  let previous: readonly [string, number] | null = null;
  const groups: Record<string, number> = {};
  rows.forEach((rawRow, rowIndex) => {
    const row = requiredObject(rawRow, `grouped row ${rowIndex + 1}`);
    if (rowIndex === 0) {
      const schema = requiredArray(row.S, "grouped row schema");
      if (
        schema.length !== 2
        || !isObject(schema[0])
        || !isObject(schema[1])
        || schema[0].N !== "G0"
        || schema[0].T !== 1
        || schema[1].N !== "M0"
        || schema[1].T !== 4
      ) {
        return sourceError("grouped row schema changed");
      }
      metadata = schema.map((item, columnIndex) => (
        requiredObject(item, `grouped field ${columnIndex + 1}`)
      ));
    } else if (row.S !== undefined) {
      return sourceError("grouped row schema repeated unexpectedly");
    }
    if (!metadata) return sourceError("grouped row schema is unavailable");
    const cells = row.C === undefined
      ? []
      : requiredArray(row.C, `grouped row ${rowIndex + 1} cells`);
    const repeatMask = mask(row.R, `grouped row ${rowIndex + 1} repeat mask`);
    const nullMask = mask(row["Ø"], `grouped row ${rowIndex + 1} null mask`);
    const decoded: [string, number] = ["", 0];
    let consumed = 0;
    for (let columnIndex = 0; columnIndex < 2; columnIndex += 1) {
      const repeated = maskIncludes(repeatMask, columnIndex);
      const absent = maskIncludes(nullMask, columnIndex);
      if (repeated && absent) {
        return sourceError(`grouped row ${rowIndex + 1} has conflicting masks`);
      }
      let value: unknown;
      if (repeated) {
        if (!previous) return sourceError("first grouped row repeats a value");
        value = previous[columnIndex];
      } else if (absent) {
        value = null;
      } else {
        if (consumed >= cells.length) {
          return sourceError(`grouped row ${rowIndex + 1} is missing a cell`);
        }
        const field = metadata[columnIndex];
        value = typeof field.DN === "string"
          ? dictionaryValue(
              dataset,
              field.DN,
              cells[consumed],
              `grouped row ${rowIndex + 1} column ${columnIndex + 1}`,
            )
          : cells[consumed];
        consumed += 1;
      }
      if (columnIndex === 0) {
        if (value !== null && typeof value !== "string") {
          return sourceError(`grouped row ${rowIndex + 1} key is not text`);
        }
        decoded[0] = value === null ? "" : value;
      } else {
        decoded[1] = count(value, `grouped row ${rowIndex + 1} count`);
      }
    }
    if (consumed !== cells.length) {
      return sourceError(`grouped row ${rowIndex + 1} has unused cells`);
    }
    if (Object.hasOwn(groups, decoded[0])) {
      return sourceError(`grouped query repeats ${decoded[0] || "blank"}`);
    }
    groups[decoded[0]] = decoded[1];
    previous = decoded;
  });
  if (Object.values(groups).reduce((sum, value) => sum + value, 0) !== grandTotal) {
    return sourceError("grouped query counts do not reconcile");
  }
  return { total: grandTotal, groups: Object.freeze(groups) } as const;
}

function melbourneTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = localAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [
        part.type,
        part.value,
      ]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant -= representedAsUtc - localAsUtc;
  }
  const finalParts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  if (
    Number(finalParts.year) !== year
    || Number(finalParts.month) !== month
    || Number(finalParts.day) !== day
    || Number(finalParts.hour) !== hour
    || Number(finalParts.minute) !== minute
    || Number(finalParts.second) !== second
  ) {
    return sourceError("refresh timestamp is not a Melbourne civil time");
  }
  return new Date(instant).toISOString();
}

export function decodeCreditexVeuPowerBiRefreshTimestamp(
  rawResponse: string,
) {
  const projection =
    "Min(LastRefreshedDateTime.Last Refreshed DateTime)";
  const dataset = responseDataset(rawResponse, [projection]);
  const phases = requiredArray(dataset.PH, "refresh query phases");
  if (phases.length !== 1 || dataset.IC !== true || dataset.HAD !== true) {
    return sourceError("refresh query shape changed");
  }
  const phase = requiredObject(phases[0], "refresh query phase");
  const rows = requiredArray(phase.DM0, "refresh query rows");
  if (rows.length !== 1) return sourceError("refresh query row count changed");
  const row = requiredObject(rows[0], "refresh query row");
  const schema = requiredArray(row.S, "refresh query schema");
  if (
    schema.length !== 1
    || !isObject(schema[0])
    || schema[0].N !== "M0"
    || schema[0].T !== 1
    || typeof row.M0 !== "string"
  ) {
    return sourceError("refresh query schema changed");
  }
  const local = row.M0;
  const match = /^(\d{1,2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/.exec(local);
  if (!match) return sourceError("refresh timestamp format changed");
  const hour12 = Number(match[4]);
  if (hour12 < 1 || hour12 > 12) {
    return sourceError("refresh timestamp hour is invalid");
  }
  const hour = (hour12 % 12) + (match[7] === "PM" ? 12 : 0);
  const utc = melbourneTimestamp(
    Number(match[3]),
    Number(match[2]),
    Number(match[1]),
    hour,
    Number(match[5]),
    Number(match[6]),
  );
  return { local, utc } as const;
}

function isoTimestamp(value: unknown, label: string) {
  const text = requiredText(value, label, 40);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    return sourceError(`${label} is not an exact ISO timestamp`);
  }
  return text;
}

function controlledCountMap(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
) {
  const object = requiredObject(value, label);
  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(object)) {
    if (!allowedKeys.has(key)) return sourceError(`${label} contains ${key}`);
    result[key] = count(rawCount, `${label} ${key || "blank"}`);
  }
  if (Object.keys(result).length !== allowedKeys.size) {
    return sourceError(`${label} is incomplete`);
  }
  return result;
}

function requiredRowText(value: VeuQueryValue, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return sourceError(`${label} is missing`);
  }
  return value.trim();
}

function optionalRowText(value: VeuQueryValue, label: string) {
  if (value === null) return "";
  if (typeof value !== "string") return sourceError(`${label} is not text`);
  return value.trim();
}

function optionalRowNumber(value: VeuQueryValue, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return sourceError(`${label} is not a number`);
  }
  return value;
}

function positiveFormulaNumber(value: number | null, label: string) {
  if (value === null || value <= 0) return sourceError(`${label} is missing`);
  return value;
}

function requiredFormulaNumber(value: number | null, label: string) {
  if (value === null) return sourceError(`${label} is missing`);
  return value;
}

type VeuSupplementalRecord = Readonly<{
  productId: string;
  category: string;
  sourceStatus: string;
  definitionIndex: number;
  values: readonly VeuQueryValue[];
}>;

function supplementalQueryForCategory(category: string) {
  return CREDITEX_VEU_SUPPLEMENTAL_QUERIES.find(
    (definition) => (definition.categories as readonly string[]).includes(category),
  );
}

function parseSupplementalEvidence(
  value: unknown,
  categoryCounts: Readonly<Record<string, number>>,
) {
  const supplements = requiredArray(value, "artifact supplements");
  if (supplements.length !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length) {
    return sourceError("artifact supplement count changed");
  }
  const records = new Map<string, VeuSupplementalRecord>();
  supplements.forEach((rawSupplement, supplementIndex) => {
    const definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[supplementIndex];
    const supplement = requiredObject(
      rawSupplement,
      `artifact supplement ${supplementIndex + 1}`,
    );
    exactKeys(
      supplement,
      ["key", "queryFields", "expectedCount", "pages"],
      `artifact supplement ${supplementIndex + 1}`,
    );
    const expectedCount = definition.categories.reduce(
      (sum, category) => sum + (categoryCounts[category] || 0),
      0,
    );
    if (
      supplement.key !== definition.key
      || JSON.stringify(supplement.queryFields) !== JSON.stringify(definition.fields)
      || supplement.expectedCount !== expectedCount
    ) {
      return sourceError(`artifact supplement ${definition.key} control changed`);
    }
    const fieldTypes = definition.fields.map((field) => (
      CREDITEX_VEU_DIM_PRODUCT_SCHEMA[
        field as keyof typeof CREDITEX_VEU_DIM_PRODUCT_SCHEMA
      ][0]
    ));
    const pages = requiredArray(
      supplement.pages,
      `artifact supplement ${definition.key} pages`,
    );
    if (
      pages.length > 10
      || (expectedCount === 0 ? pages.length !== 0 : pages.length < 1)
    ) {
      return sourceError(`artifact supplement ${definition.key} page count changed`);
    }
    const allowedCategories = new Set<string>(definition.categories);
    let expectedAfterId: string | null = null;
    let terminalSeen = false;
    let decodedCount = 0;
    pages.forEach((rawPage, pageIndex) => {
      const page = requiredObject(
        rawPage,
        `artifact supplement ${definition.key} page ${pageIndex + 1}`,
      );
      exactKeys(
        page,
        ["afterId", "response"],
        `artifact supplement ${definition.key} page ${pageIndex + 1}`,
      );
      if (page.afterId !== expectedAfterId || terminalSeen) {
        return sourceError(`artifact supplement ${definition.key} cursor changed`);
      }
      const decoded = decodeCreditexVeuPowerBiProductPage(
        requiredText(
          page.response,
          `artifact supplement ${definition.key} response`,
          30_000_000,
        ),
        definition.fields,
        fieldTypes,
      );
      for (const row of decoded.rows) {
        const id = requiredRowText(row[0], `supplement ${definition.key} Id`);
        const productId = requiredRowText(
          row[1],
          `supplement ${definition.key} Product ID`,
        );
        const category = optionalRowText(
          row[2],
          `supplement ${definition.key} category`,
        );
        const sourceStatus = requiredRowText(
          row[3],
          `supplement ${definition.key} status`,
        );
        if (
          (expectedAfterId && id.toLowerCase() <= expectedAfterId.toLowerCase())
          || !allowedCategories.has(category)
          || (sourceStatus !== "Approved" && sourceStatus !== "Legacy")
          || records.has(id)
          || (
            "productIds" in definition
            && !(definition.productIds as readonly string[]).includes(productId)
          )
        ) {
          return sourceError(`supplement ${definition.key} identity changed`);
        }
        expectedAfterId = id;
        records.set(id, {
          productId,
          category,
          sourceStatus,
          definitionIndex: supplementIndex,
          values: row.slice(4),
        });
        decodedCount += 1;
      }
      delete page.response;
      terminalSeen = !decoded.continuation;
      if (pageIndex < pages.length - 1 && terminalSeen) {
        return sourceError(`artifact supplement ${definition.key} ended early`);
      }
    });
    if ((expectedCount > 0 && !terminalSeen) || decodedCount !== expectedCount) {
      return sourceError(`artifact supplement ${definition.key} did not reconcile`);
    }
    delete supplement.pages;
  });
  return records;
}

function supplementalValue(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
) {
  if (!supplement) return null;
  const definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[
    supplement.definitionIndex
  ];
  const fieldIndex = (definition.fields as readonly string[]).indexOf(field);
  if (fieldIndex < 4) return null;
  return supplement.values[fieldIndex - 4] ?? null;
}

function supplementalNumber(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
) {
  return optionalRowNumber(supplementalValue(supplement, field), label);
}

function supplementalText(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
) {
  return optionalRowText(supplementalValue(supplement, field), label);
}

function supplementalBoolean(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
) {
  const value = supplementalValue(supplement, field);
  if (value === null) return null;
  if (typeof value !== "boolean") return sourceError(`${label} is not boolean`);
  return value;
}

function requiredSupplementalNumber(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
  positive = false,
) {
  const value = requiredFormulaNumber(
    supplementalNumber(supplement, field, label),
    label,
  );
  if (positive && value <= 0) return sourceError(`${label} is not positive`);
  return value;
}

function requiredSupplementalText(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
) {
  const value = supplementalText(supplement, field, label);
  if (!value) return sourceError(`${label} is missing`);
  return value;
}

function requiredSupplementalBoolean(
  supplement: VeuSupplementalRecord | undefined,
  field: string,
  label: string,
) {
  const value = supplementalBoolean(supplement, field, label);
  if (value === null) return sourceError(`${label} is missing`);
  return value;
}

function roundedSignificant(value: number, digits: number, label: string) {
  if (!Number.isFinite(value) || digits < 1 || digits > 15) {
    return sourceError(`${label} cannot be rounded to governed precision`);
  }
  return positiveZero(Number(value.toPrecision(digits)));
}

function governedSupplementalAttribute(
  category: string,
  field: string,
  value: VeuQueryValue,
  label: string,
): VeuQueryValue {
  if (category !== "44A" || typeof value !== "number") return value;
  if (field === "Total_Heat_Pump_Thermal_Capacity_kW__c") {
    return positiveZero(Number(value.toFixed(1)));
  }
  if (
    field === "Zone_4_Annual_Energy_Savings__c"
    || field === "Zone_5_Annual_Energy_Savings__c"
  ) {
    return roundedSignificant(value, 2, label);
  }
  if (
    field === "Zone_4_HPelec_GLyear__c"
    || field === "Zone_4_HPgas_GJyear__c"
    || field === "Zone_4_Peak_Load_MJday__c"
    || field === "Zone_5_HPelec_GLyear__c"
    || field === "Zone_5_HPgas_GJyear__c"
    || field === "Zone_5_Peak_Load_MJday__c"
  ) {
    return roundedSignificant(value, 4, label);
  }
  return value;
}

function validateApprovedFormulaFields(
  index: number,
  category: string,
  sourceStatus: string,
  supplement: VeuSupplementalRecord | undefined,
  attributes: Record<string, string | number | boolean | null>,
  wersHeatingStars: number | null,
) {
  if (sourceStatus !== "Approved") return;
  const label = `record ${index}`;
  if (["1C", "1D", "3C", "3D"].includes(category)) {
    const systemSize = supplementalText(
      supplement,
      "System_Size__c",
      `${label} system size`,
    );
    const systemSizeRecognized = systemSize === "Small" || systemSize === "Medium";
    attributes.veuWaterHeaterSystemSizeRecognized = systemSizeRecognized;
    const zone4Fields = [
      "Zone_4_Bs_GJyear_system_load_size__c",
      "Zone_4_Be_GJyear_system_load_size__c",
      "Zone_4_Bs_GJyear_step_down_load_size__c",
      "Zone_4_Be_GJyear_step_down_load_size__c",
    ];
    const zone4Values = zone4Fields.map((field) => (
      supplementalNumber(supplement, field, `${label} ${field}`)
    ));
    const zone4AnnualSavings = supplementalNumber(
      supplement,
      "Zone_4_Annual_Energy_Savings_system_l__c",
      `${label} zone 4 annual energy savings`,
    );
    attributes.veuZone4ModelDataAvailable = Boolean(
      systemSizeRecognized
      && zone4Values.every((value) => value !== null)
      && zone4AnnualSavings !== null
      && zone4AnnualSavings >= 60,
    );
    const zone5Fields = [
      "Zone_5_Bs_GJyear_system_load_size__c",
      "Zone_5_Be_GJyear_system_load_size__c",
      "Zone_5_Bs_GJyear_step_down_load_size__c",
      "Zone_5_Be_GJyear_step_down_load_size__c",
    ];
    const zone5Values = zone5Fields.map((field) => (
      supplementalNumber(supplement, field, `${label} ${field}`)
    ));
    const zone5AnnualSavings = supplementalNumber(
      supplement,
      "Zone_5_Annual_Energy_Savings_system_l__c",
      `${label} zone 5 annual energy savings`,
    );
    attributes.veuZone5ModelDataAvailable = Boolean(
      systemSizeRecognized
      && zone5Values.every((value) => value !== null)
      && zone5AnnualSavings !== null
      && zone5AnnualSavings >= 60,
    );
  }
  if (category.startsWith("6")) {
    const configuration = requiredSupplementalText(
      supplement,
      "Product_Configuration__c",
      `${label} air-conditioner configuration`,
    );
    const configurationClass = {
      "Single split system": "single",
      "Multiple split - variable refrigerant flow": "multi",
      "Multiple split - fixed head": "multi",
      Packaged: "packaged",
    }[configuration];
    if (!configurationClass) {
      return sourceError(`${label} air-conditioner configuration changed`);
    }
    attributes.veuProductConfigurationClass = configurationClass;
    const productType = requiredSupplementalText(
      supplement,
      "Product_Type__c",
      `${label} air-conditioner product type`,
    );
    const productTypeClass = {
      Ducted: "ducted",
      "Non-Ducted": "non_ducted",
    }[productType];
    if (!productTypeClass) {
      return sourceError(`${label} air-conditioner product type changed`);
    }
    attributes.veuProductTypeClass = productTypeClass;
    for (const field of [
      "Heating_Capacity_kW__c",
      "Cooling_Capacity_kW__c",
      "ACOP__c",
      "AEER__c",
    ]) {
      requiredSupplementalNumber(supplement, field, `${label} ${field}`, true);
    }
    for (const field of [
      "GEMS_HSPF_Cold_res__c",
      "GEMS_TCSPF_Cold_res__c",
      "GEMS_HSPF_Mixed_res__c",
      "GEMS_TCSPF_Mixed_res__c",
      "GEMS_HSPF_Cold_com__c",
      "GEMS_TCSPF_Cold_com__c",
      "GEMS_HSPF_Mixed_com__c",
      "GEMS_TCSPF_Mixed_com__c",
    ]) {
      requiredSupplementalNumber(supplement, field, `${label} ${field}`);
    }
    requiredSupplementalText(
      supplement,
      "Refrigerant_Type_GWP__c",
      `${label} refrigerant type`,
    );
    requiredSupplementalText(
      supplement,
      "GEMS_Class__c",
      `${label} GEMS class`,
    );
    requiredSupplementalBoolean(
      supplement,
      "GEMS_Registered_Before_2_August_2024__c",
      `${label} GEMS registration-date flag`,
    );
  }
  if (category === "13A") {
    positiveFormulaNumber(wersHeatingStars, `${label} WERS heating stars`);
  }
  if (category === "14A" || category === "14B") {
    requiredSupplementalText(
      supplement,
      "Product_Type__c",
      `${label} secondary-glazing product type`,
    );
  }
  if (["15A", "15B", "15C", "15D", "15E", "15H"].includes(category)) {
    requiredSupplementalNumber(
      supplement,
      "Warranty_Period_Years__c",
      `${label} warranty years`,
      true,
    );
  }
  if (category === "26A") {
    const paec = requiredSupplementalNumber(
      supplement,
      "PAEC_kWhy__c",
      `${label} PAEC`,
    );
    if (paec < 0) return sourceError(`${label} PAEC is negative`);
  }
  if (category === "27A" || category === "27B") {
    requiredSupplementalNumber(
      supplement,
      "LCPVictorian_Load_W__c",
      `${label} Victorian-load LCP`,
      true,
    );
  }
  if (category === "32A") {
    requiredSupplementalText(
      supplement,
      "Product_Class__c",
      `${label} refrigerated-cabinet product class`,
    );
    requiredSupplementalText(
      supplement,
      "Characteristic_Code__c",
      `${label} refrigerated-cabinet characteristic code`,
    );
    requiredSupplementalNumber(
      supplement,
      "Energy_Efficiency_Index__c",
      `${label} energy-efficiency index`,
      true,
    );
    requiredSupplementalNumber(
      supplement,
      "Total_Energy_Consumption_kWh24h__c",
      `${label} total energy consumption`,
      true,
    );
    const displayArea = requiredSupplementalNumber(
      supplement,
      "Total_Display_Area_m2__c",
      `${label} total display area`,
    );
    const netVolume = requiredSupplementalNumber(
      supplement,
      "Net_Volume_L__c",
      `${label} net volume`,
    );
    if (displayArea <= 0 && netVolume <= 0) {
      return sourceError(`${label} has no positive display area or net volume`);
    }
  }
  if (category === "33A") {
    requiredSupplementalNumber(
      supplement,
      "Input_Power_W__c",
      `${label} nameplate fan input power`,
      true,
    );
    requiredSupplementalNumber(
      supplement,
      "Output_Power_W__c",
      `${label} rated motor output power`,
      true,
    );
    requiredSupplementalText(
      supplement,
      "Rotor_Motor_Type__c",
      `${label} rotor motor type`,
    );
  }
  if (category === "34C") {
    requiredSupplementalText(
      supplement,
      "Product_Type__c",
      `${label} lighting product type`,
    );
    const lcp = supplementalNumber(
      supplement,
      "LCP_W__c",
      `${label} lamp circuit power`,
    );
    const nominalLampPower = supplementalNumber(
      supplement,
      "NLP_W__c",
      `${label} nominal lamp power`,
    );
    if ((lcp ?? 0) <= 0 && (nominalLampPower ?? 0) <= 0) {
      return sourceError(`${label} has no governed lighting power value`);
    }
  }
  if (category === "35B") {
    requiredSupplementalNumber(
      supplement,
      "LCP_W__c",
      `${label} lamp circuit power`,
      true,
    );
    requiredSupplementalNumber(
      supplement,
      "NLP_W__c",
      `${label} nominal lamp power`,
      true,
    );
    requiredSupplementalNumber(
      supplement,
      "Reported_Lifetime_L70__c",
      `${label} reported L70 lifetime`,
      true,
    );
  }
  if (category === "44A") {
    for (const field of [
      "Number_of_Heat_Pumps__c",
      "Number_of_Tanks__c",
      "Total_Heat_Pump_Thermal_Capacity_kW__c",
      "Total_Thermal_Capacity_kW__c",
      "Total_System_Tank_Volume_L__c",
      "Zone_4_Annual_Energy_Savings__c",
      "Zone_4_HPelec_GLyear__c",
      "Zone_4_Peak_Load_MJday__c",
      "Refrigerant_Charge_kg__c",
    ]) {
      requiredSupplementalNumber(supplement, field, `${label} ${field}`, true);
    }
    for (const field of [
      "Zone_4_HPgas_GJyear__c",
      "Zone_5_Annual_Energy_Savings__c",
      "Zone_5_HPelec_GLyear__c",
      "Zone_5_HPgas_GJyear__c",
      "Zone_5_Peak_Load_MJday__c",
    ]) {
      requiredSupplementalNumber(supplement, field, `${label} ${field}`);
    }
    requiredSupplementalText(
      supplement,
      "Refrigerant_Type_GWP__c",
      `${label} refrigerant type`,
    );
  }
  if (category === "46A" || category === "46B") {
    requiredSupplementalNumber(
      supplement,
      "Width_mm__c",
      `${label} cooktop width`,
      true,
    );
    requiredSupplementalNumber(
      supplement,
      "Depth_mm__c",
      `${label} cooktop depth`,
      true,
    );
    requiredSupplementalText(
      supplement,
      "Product_Type__c",
      `${label} cooktop product type`,
    );
  }
  if (category === "48A" || category === "48B") {
    requiredSupplementalNumber(
      supplement,
      "R_Value__c",
      `${label} insulation R-value`,
      true,
    );
    requiredSupplementalText(
      supplement,
      "Product_Type__c",
      `${label} insulation product type`,
    );
  }
}

function productRecord(
  row: readonly VeuQueryValue[],
  index: number,
  supplement: VeuSupplementalRecord | undefined,
): CreditexOfficialProductRecord {
  const salesforceId = requiredRowText(row[0], `record ${index} Salesforce Id`);
  const productId = requiredRowText(row[1], `record ${index} Product ID`);
  const legacyProductId = optionalRowText(row[2], `record ${index} legacy Product ID`);
  const category = optionalRowText(row[3], `record ${index} category`);
  const activityTypeId = optionalRowText(row[4], `record ${index} activity type`);
  const brand = requiredRowText(row[5], `record ${index} brand`);
  const model = requiredRowText(row[6], `record ${index} model`);
  const sourceStatus = requiredRowText(row[7], `record ${index} status`);
  if (sourceStatus !== "Approved" && sourceStatus !== "Legacy") {
    return sourceError(`record ${index} has unsupported status ${sourceStatus}`);
  }
  const supplementalQuery = supplementalQueryForCategory(category);
  if (
    Boolean(supplementalQuery) !== Boolean(supplement)
    || (
      supplement
      && (
        supplement.productId !== productId
        || supplement.category !== category
        || supplement.sourceStatus !== sourceStatus
      )
    )
  ) {
    return sourceError(`record ${index} supplemental evidence does not match`);
  }
  const eligibleFrom = requiredRowText(row[8], `record ${index} effective from`);
  const eligibleTo = optionalRowText(row[9], `record ${index} effective to`);
  if (
    !category
    && (
      !CREDITEX_VEU_PROJECT_BASED_LIGHTING_PRODUCT_IDS.has(productId)
      || activityTypeId !== CREDITEX_VEU_PROJECT_BASED_LIGHTING_ACTIVITY_TYPE_ID
      || !legacyProductId.endsWith(
        CREDITEX_VEU_PROJECT_BASED_LIGHTING_LEGACY_SUFFIX,
      )
    )
  ) {
    return sourceError(
      `record ${index} has an unrecognised blank-category product identity`,
    );
  }
  const mappedKind = category
    ? CREDITEX_VEU_CATEGORY_PRODUCT_KIND[
        category as keyof typeof CREDITEX_VEU_CATEGORY_PRODUCT_KIND
      ]
    : "veu_project_based_lighting_product";
  if (!mappedKind) {
    return sourceError(`record ${index} has unknown category ${category}`);
  }
  const totalVolumeLitres = optionalRowNumber(row[10], `record ${index} total volume`);
  const starRating = optionalRowNumber(row[11], `record ${index} star rating`);
  const cecKwhPerYear = optionalRowNumber(row[12], `record ${index} CEC`);
  const screenAreaCm2 = optionalRowNumber(row[13], `record ${index} screen area`);
  const capacityKg = optionalRowNumber(row[14], `record ${index} capacity`);
  const gemsDeterminationVersion = optionalRowText(
    row[15],
    `record ${index} GEMS determination version`,
  );
  const wersHeatingStars = optionalRowNumber(
    row[16],
    `record ${index} WERS heating stars`,
  );
  const attributes: Record<string, string | number | boolean | null> = {
    veuProductId: productId,
    veuSalesforceRecordId: salesforceId,
    veuProductCategoryNumber: category,
    sourceStatus,
  };
  if (activityTypeId) attributes.veuActivityTypeId = activityTypeId;
  if (legacyProductId) attributes.veuLegacyProductId = legacyProductId;
  if (totalVolumeLitres !== null) attributes.totalVolumeLitres = totalVolumeLitres;
  if (starRating !== null) attributes.starRating = starRating;
  if (cecKwhPerYear !== null) {
    attributes.comparativeEnergyConsumptionKwhPerYear = cecKwhPerYear;
  }
  if (screenAreaCm2 !== null) attributes.screenAreaCm2 = screenAreaCm2;
  if (capacityKg !== null) attributes.capacityKg = capacityKg;
  if (gemsDeterminationVersion) {
    attributes.gemsDeterminationVersion = gemsDeterminationVersion;
  }
  if (wersHeatingStars !== null) {
    attributes.wersHeatingStars = wersHeatingStars;
  }
  if (supplement) {
    const definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[
      supplement.definitionIndex
    ];
    definition.fields.slice(4).forEach((field, fieldIndex) => {
      const attributeKey = CREDITEX_VEU_SUPPLEMENT_ATTRIBUTE_KEYS[field];
      if (!attributeKey) {
        return sourceError(
          `record ${index} has unmapped supplemental field ${field}`,
        );
      }
      const value = governedSupplementalAttribute(
        category,
        field,
        supplement.values[fieldIndex],
        `record ${index} ${field}`,
      );
      if (value !== null) attributes[attributeKey] = value;
    });
  }
  validateApprovedFormulaFields(
    index,
    category,
    sourceStatus,
    supplement,
    attributes,
    wersHeatingStars,
  );
  if (sourceStatus === "Approved" && category.startsWith("22")) {
    positiveFormulaNumber(totalVolumeLitres, `record ${index} total volume`);
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
    if (!gemsDeterminationVersion) {
      return sourceError(`record ${index} GEMS determination version is missing`);
    }
  }
  if (sourceStatus === "Approved" && category === "24A") {
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(screenAreaCm2, `record ${index} screen area`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
  }
  if (sourceStatus === "Approved" && category === "25A") {
    positiveFormulaNumber(starRating, `record ${index} star rating`);
    positiveFormulaNumber(capacityKg, `record ${index} capacity`);
    positiveFormulaNumber(cecKwhPerYear, `record ${index} CEC`);
  }
  return {
    sourceKey: CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY,
    sourceRecordKey: productId,
    productKind: mappedKind,
    manufacturer: "",
    brand,
    model,
    series: "",
    registrationNumber: productId,
    certificateNumber: "",
    approvalStatus: sourceStatus.toLowerCase(),
    eligibleFrom,
    eligibleTo,
    availableInAustralia: true,
    attributes,
  };
}

function parseCreditexVeuLegacyProductArtifact(
  bytes: Uint8Array,
  contentType: string,
): readonly CreditexOfficialProductRecord[] {
  if (contentType !== "application/json") {
    return sourceError("artifact content type changed");
  }
  let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/\"embedToken\"|\"Authorization\"\s*:\s*\"EmbedToken/i.test(text)) {
    return sourceError("artifact contains an authentication secret");
  }
  const artifact = requiredObject(parseJson(text, "artifact"), "artifact");
  text = "";
  exactKeys(artifact, [
    "contract",
    "sourceKey",
    "reportId",
    "datasetId",
    "modelId",
    "sourceRefreshedAt",
    "queryFields",
    "controls",
    "pages",
    "supplements",
  ], "artifact");
  if (
    artifact.contract !== CREDITEX_VEU_PRODUCT_ARTIFACT_CONTRACT
    || artifact.sourceKey !== CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY
    || artifact.reportId !== CREDITEX_VEU_REPORT_ID
    || artifact.datasetId !== CREDITEX_VEU_DATASET_ID
    || artifact.modelId !== CREDITEX_VEU_MODEL_ID
    || JSON.stringify(artifact.queryFields) !== JSON.stringify(CREDITEX_VEU_QUERY_FIELDS)
  ) {
    return sourceError("artifact identity or schema changed");
  }
  const sourceRefreshedAt = isoTimestamp(
    artifact.sourceRefreshedAt,
    "source refresh timestamp",
  );
  const controls = requiredObject(artifact.controls, "artifact controls");
  exactKeys(controls, [
    "total",
    "statuses",
    "categories",
    "modelResponse",
    "conceptualSchemaResponse",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ], "artifact controls");
  const total = count(controls.total, "artifact total");
  const statuses = controlledCountMap(
    controls.statuses,
    "artifact statuses",
    new Set(["Approved", "Legacy"]),
  );
  const categories = controlledCountMap(
    controls.categories,
    "artifact categories",
    new Set(["", ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND)]),
  );
  validateCreditexVeuPowerBiModelAndSchema(
    requiredText(
      controls.modelResponse,
      "artifact modelResponse",
      20_000_000,
    ),
    requiredText(
      controls.conceptualSchemaResponse,
      "artifact conceptualSchemaResponse",
      20_000_000,
    ),
  );
  for (const evidenceField of [
    "modelResponse",
    "conceptualSchemaResponse",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ] as const) {
    const raw = requiredText(
      controls[evidenceField],
      `artifact ${evidenceField}`,
      20_000_000,
    );
    parseJson(raw, `artifact ${evidenceField}`);
  }
  const decodedTotal = decodeCreditexVeuPowerBiAggregateCount(
    String(controls.totalResponse),
  );
  const decodedStatuses = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.statusResponse),
    "Product_Status__c",
  );
  const decodedCategories = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.categoryResponse),
    "Product_Category_Number__c",
  );
  const decodedRefresh = decodeCreditexVeuPowerBiRefreshTimestamp(
    String(controls.refreshResponse),
  );
  const categoryControlFromSource = Object.fromEntries(
    Object.keys(categories).map((key) => [
      key,
      decodedCategories.groups[key] || 0,
    ]),
  );
  if (
    decodedTotal !== total
    || decodedRefresh.utc !== sourceRefreshedAt
    || decodedStatuses.total !== total
    || decodedCategories.total !== total
    || JSON.stringify(decodedStatuses.groups) !== JSON.stringify(statuses)
    || JSON.stringify(categoryControlFromSource) !== JSON.stringify(categories)
    || Object.values(statuses).reduce((sum, value) => sum + value, 0) !== total
    || Object.values(categories).reduce((sum, value) => sum + value, 0) !== total
  ) {
    return sourceError("official aggregate controls do not reconcile");
  }
  for (const evidenceField of [
    "modelResponse",
    "conceptualSchemaResponse",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ]) {
    delete controls[evidenceField];
  }
  delete artifact.controls;
  const supplementalRecords = parseSupplementalEvidence(
    artifact.supplements,
    categories,
  );
  delete artifact.supplements;
  const pages = requiredArray(artifact.pages, "artifact pages");
  if (pages.length < 1 || pages.length > 10) {
    return sourceError("artifact page count is outside the controlled bound");
  }
  const records: CreditexOfficialProductRecord[] = [];
  const derivedStatuses: Record<string, number> = { Approved: 0, Legacy: 0 };
  const derivedCategories: Record<string, number> = Object.fromEntries(
    Object.keys(categories).map((key) => [key, 0]),
  );
  let expectedAfterId: string | null = null;
  let terminalSeen = false;
  pages.forEach((rawPage, pageIndex) => {
    const page = requiredObject(rawPage, `artifact page ${pageIndex + 1}`);
    exactKeys(page, ["afterId", "response"], `artifact page ${pageIndex + 1}`);
    if (page.afterId !== expectedAfterId) {
      return sourceError(`artifact page ${pageIndex + 1} has the wrong cursor`);
    }
    if (terminalSeen) return sourceError("artifact has a page after completion");
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(page.response, `artifact page ${pageIndex + 1} response`, 30_000_000),
    );
    delete page.response;
    for (const row of decoded.rows) {
      const id = requiredRowText(row[0], "page Salesforce Id");
      if (
        expectedAfterId
        && id.toLowerCase() <= expectedAfterId.toLowerCase()
      ) {
        return sourceError("product pagination is not strictly monotonic");
      }
      expectedAfterId = id;
      const supplement = supplementalRecords.get(id);
      const record = productRecord(row, records.length + 1, supplement);
      if (supplement) supplementalRecords.delete(id);
      const category = String(
        record.attributes.veuProductCategoryNumber || "",
      );
      const sourceStatus = String(record.attributes.sourceStatus);
      derivedStatuses[sourceStatus] += 1;
      derivedCategories[category] += 1;
      records.push(record);
    }
    terminalSeen = !decoded.continuation;
    if (pageIndex < pages.length - 1 && terminalSeen) {
      return sourceError("artifact completed before its last page");
    }
  });
  if (records.length !== total) {
    return sourceError(`product rows ${records.length} do not match total ${total}`);
  }
  if (supplementalRecords.size !== 0) {
    return sourceError("supplemental rows do not match base product identities");
  }
  if (
    JSON.stringify(derivedStatuses) !== JSON.stringify(statuses)
    || JSON.stringify(derivedCategories) !== JSON.stringify(categories)
  ) {
    return sourceError("decoded rows do not match official aggregate controls");
  }
  delete artifact.pages;
  return Object.freeze(records);
}

function* veuStreamLines(bytes: Uint8Array) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  let lineNumber = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 10) continue;
    if (index === start || index - start > 30_000_000) {
      return sourceError("stream artifact line is outside its controlled bound");
    }
    let text = "";
    try {
      text = decoder.decode(bytes.subarray(start, index));
    } catch {
      return sourceError("stream artifact is not valid UTF-8");
    }
    lineNumber += 1;
    if (/\"embedToken\"|\"Authorization\"\s*:\s*\"EmbedToken/i.test(text)) {
      return sourceError("artifact contains an authentication secret");
    }
    yield {
      lineNumber,
      value: requiredObject(
        parseJson(text, `artifact line ${lineNumber}`),
        `artifact line ${lineNumber}`,
      ),
    };
    start = index + 1;
  }
  if (start !== bytes.byteLength || lineNumber < 2) {
    return sourceError("stream artifact is incomplete");
  }
}

function validateVeuStreamHeader(header: JsonObject, bytes?: Uint8Array) {
  exactKeys(header, [
    "recordType",
    "contract",
    "sourceKey",
    "reportId",
    "datasetId",
    "modelId",
    "sourceRefreshedAt",
    "queryFields",
    "controls",
  ], "artifact header");
  if (
    header.recordType !== "header"
    || (
      header.contract !== CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT
      && header.contract !== CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT
    )
    || header.sourceKey !== CREDITEX_VEU_PUBLIC_REGISTRY_SOURCE_KEY
    || header.reportId !== CREDITEX_VEU_REPORT_ID
    || header.datasetId !== CREDITEX_VEU_DATASET_ID
    || header.modelId !== CREDITEX_VEU_MODEL_ID
    || JSON.stringify(header.queryFields)
      !== JSON.stringify(CREDITEX_VEU_QUERY_FIELDS)
  ) {
    return sourceError("stream artifact identity or schema changed");
  }
  const sourceRefreshedAt = isoTimestamp(
    header.sourceRefreshedAt,
    "source refresh timestamp",
  );
  const controls = requiredObject(header.controls, "artifact controls");
  const boundedStream = header.contract
    === CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT;
  exactKeys(controls, [
    "total",
    "statuses",
    "categories",
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
    ...(boundedStream ? [] : ["modelResponse", "conceptualSchemaResponse"]),
  ], "artifact controls");
  const total = count(controls.total, "artifact total");
  const statuses = controlledCountMap(
    controls.statuses,
    "artifact statuses",
    new Set(["Approved", "Legacy"]),
  );
  const categories = controlledCountMap(
    controls.categories,
    "artifact categories",
    new Set(["", ...Object.keys(CREDITEX_VEU_CATEGORY_PRODUCT_KIND)]),
  );
  if (boundedStream) {
    if (!bytes) return sourceError("bounded stream controls are unavailable");
    const seen = new Set<string>();
    for (const { value } of veuStreamLines(bytes)) {
      if (value.recordType !== "control") continue;
      exactKeys(value, ["recordType", "key", "response"], "artifact control");
      const key = requiredText(value.key, "artifact control key", 80);
      const response = requiredText(value.response, `artifact ${key}`, 12_000_000);
      if (seen.has(key)) return sourceError("artifact control is duplicated");
      if (key === "modelResponse") validateCreditexVeuPowerBiModel(response);
      else if (key === "conceptualSchemaResponse") {
        validateCreditexVeuPowerBiSchema(response);
      } else return sourceError("artifact control identity changed");
      seen.add(key);
    }
    if (
      !seen.has("modelResponse")
      || !seen.has("conceptualSchemaResponse")
      || seen.size !== 2
    ) {
      return sourceError("artifact controls are incomplete");
    }
  } else {
    validateCreditexVeuPowerBiModelAndSchema(
      requiredText(controls.modelResponse, "artifact modelResponse", 20_000_000),
      requiredText(
        controls.conceptualSchemaResponse,
        "artifact conceptualSchemaResponse",
        20_000_000,
      ),
    );
  }
  for (const evidenceField of [
    "totalResponse",
    "statusResponse",
    "categoryResponse",
    "refreshResponse",
  ] as const) {
    parseJson(
      requiredText(
        controls[evidenceField],
        `artifact ${evidenceField}`,
        20_000_000,
      ),
      `artifact ${evidenceField}`,
    );
  }
  const decodedTotal = decodeCreditexVeuPowerBiAggregateCount(
    String(controls.totalResponse),
  );
  const decodedStatuses = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.statusResponse),
    "Product_Status__c",
  );
  const decodedCategories = decodeCreditexVeuPowerBiGroupedCounts(
    String(controls.categoryResponse),
    "Product_Category_Number__c",
  );
  const decodedRefresh = decodeCreditexVeuPowerBiRefreshTimestamp(
    String(controls.refreshResponse),
  );
  const sourceCategories = Object.fromEntries(
    Object.keys(categories).map((key) => [
      key,
      decodedCategories.groups[key] || 0,
    ]),
  );
  if (
    decodedTotal !== total
    || decodedRefresh.utc !== sourceRefreshedAt
    || decodedStatuses.total !== total
    || decodedCategories.total !== total
    || JSON.stringify(decodedStatuses.groups) !== JSON.stringify(statuses)
    || JSON.stringify(sourceCategories) !== JSON.stringify(categories)
    || Object.values(statuses).reduce((sum, value) => sum + value, 0) !== total
    || Object.values(categories).reduce((sum, value) => sum + value, 0) !== total
  ) {
    return sourceError("official aggregate controls do not reconcile");
  }
  return { total, statuses, categories } as const;
}

function parseCreditexVeuStreamProductArtifact(bytes: Uint8Array) {
  let header: JsonObject | null = null;
  const supplements: JsonObject[] = [];
  let pageCount = 0;
  for (const { lineNumber, value } of veuStreamLines(bytes)) {
    const recordType = value.recordType;
    if (lineNumber === 1) {
      header = value;
      continue;
    }
    if (recordType === "page") {
      exactKeys(value, ["recordType", "afterId", "response"],
        `artifact page line ${lineNumber}`);
      pageCount += 1;
      continue;
    }
    if (recordType === "supplement") {
      if (Object.hasOwn(value, "pages")) {
        exactKeys(value, [
          "recordType",
          "key",
          "queryFields",
          "expectedCount",
          "pages",
        ], `artifact supplement line ${lineNumber}`);
        const supplement = { ...value };
        delete supplement.recordType;
        supplements.push(supplement);
      } else {
        exactKeys(value, [
          "recordType",
          "key",
          "queryFields",
          "expectedCount",
        ], `artifact supplement line ${lineNumber}`);
      }
      continue;
    }
    if (recordType === "supplement-page") continue;
    if (recordType === "control") continue;
    return sourceError(`artifact line ${lineNumber} has an unknown type`);
  }
  if (!header || pageCount < 1 || pageCount > 200) {
    return sourceError("stream artifact page count is outside the controlled bound");
  }
  const { total, statuses, categories } = validateVeuStreamHeader(header, bytes);
  const supplementalRecords = new Map<string, VeuSupplementalRecord>();
  if (header.contract === CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT) {
    for (const batch of creditexVeuSupplementalBatches(bytes, "application/json")) {
      for (const item of batch) {
        if (supplementalRecords.has(item.sourceRecordKey)) {
          return sourceError("artifact contains duplicate supplemental identity");
        }
        supplementalRecords.set(
          item.sourceRecordKey,
          item.value as unknown as VeuSupplementalRecord,
        );
      }
    }
  } else {
    for (const [key, value] of parseSupplementalEvidence(
      supplements,
      categories,
    )) {
      supplementalRecords.set(key, value);
    }
  }
  const records: CreditexOfficialProductRecord[] = [];
  const derivedStatuses: Record<string, number> = { Approved: 0, Legacy: 0 };
  const derivedCategories: Record<string, number> = Object.fromEntries(
    Object.keys(categories).map((key) => [key, 0]),
  );
  let expectedAfterId: string | null = null;
  let terminalSeen = false;
  let decodedPageCount = 0;
  for (const { value } of veuStreamLines(bytes)) {
    if (value.recordType !== "page") continue;
    decodedPageCount += 1;
    if (value.afterId !== expectedAfterId || terminalSeen) {
      return sourceError(`artifact page ${decodedPageCount} cursor changed`);
    }
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(
        value.response,
        `artifact page ${decodedPageCount} response`,
        12_000_000,
      ),
      CREDITEX_VEU_QUERY_FIELDS,
      CREDITEX_VEU_QUERY_FIELD_TYPES,
      CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE,
    );
    for (const row of decoded.rows) {
      const id = requiredRowText(row[0], "page Salesforce Id");
      if (expectedAfterId && id.toLowerCase() <= expectedAfterId.toLowerCase()) {
        return sourceError("product pagination is not strictly monotonic");
      }
      expectedAfterId = id;
      const supplement = supplementalRecords.get(id);
      const record = productRecord(row, records.length + 1, supplement);
      if (supplement) supplementalRecords.delete(id);
      const category = String(record.attributes.veuProductCategoryNumber || "");
      const sourceStatus = String(record.attributes.sourceStatus);
      derivedStatuses[sourceStatus] += 1;
      derivedCategories[category] += 1;
      records.push(record);
    }
    terminalSeen = !decoded.continuation;
    if (decodedPageCount < pageCount && terminalSeen) {
      return sourceError("artifact completed before its last page");
    }
  }
  if (
    decodedPageCount !== pageCount
    || records.length !== total
    || !terminalSeen
    || supplementalRecords.size !== 0
  ) {
    return sourceError("stream artifact records did not reconcile");
  }
  if (
    JSON.stringify(derivedStatuses) !== JSON.stringify(statuses)
    || JSON.stringify(derivedCategories) !== JSON.stringify(categories)
  ) {
    return sourceError("decoded rows do not match official aggregate controls");
  }
  return Object.freeze(records);
}

const CREDITEX_VEU_STREAM_BATCH_SIZE = 500;
const CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE = 5_000;
const CREDITEX_VEU_STREAM_MAXIMUM_RESUME_BATCHES = 2_000;

function creditexVeuStreamHeader(bytes: Uint8Array) {
  let header: JsonObject | null = null;
  let pageCount = 0;
  let supplementCount = 0;
  let supplementPageCount = 0;
  for (const { lineNumber, value } of veuStreamLines(bytes)) {
    if (lineNumber === 1) {
      header = value;
      continue;
    }
    if (value.recordType === "page") pageCount += 1;
    else if (value.recordType === "supplement") supplementCount += 1;
    else if (value.recordType === "supplement-page") supplementPageCount += 1;
    else if (value.recordType === "control") continue;
    else return sourceError(`artifact line ${lineNumber} has an unknown type`);
  }
  if (
    !header
    || pageCount < 1
    || pageCount > 200
    || supplementCount !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length
    || (
      header.contract === CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT
      && supplementPageCount !== 0
    )
  ) {
    return sourceError("stream artifact structure is outside the controlled bound");
  }
  return {
    ...validateVeuStreamHeader(header, bytes),
    contract: header.contract,
    pageCount,
  };
}

function* creditexVeuBoundedSupplementalBatches(
  bytes: Uint8Array,
  categories: Readonly<Record<string, number>>,
): Generator<readonly CreditexOfficialProductStreamValue[]> {
  let supplementIndex = -1;
  let definition: (typeof CREDITEX_VEU_SUPPLEMENTAL_QUERIES)[number] | null = null;
  let expectedCount = 0;
  let decodedCount = 0;
  let expectedAfterId: string | null = null;
  let terminalSeen = false;
  const finishCurrent = () => {
    if (
      definition
      && (
        decodedCount !== expectedCount
        || (expectedCount > 0 && !terminalSeen)
      )
    ) {
      return sourceError(`artifact supplement ${definition.key} did not reconcile`);
    }
  };
  for (const { value } of veuStreamLines(bytes)) {
    if (value.recordType === "supplement") {
      finishCurrent();
      supplementIndex += 1;
      definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[supplementIndex] || null;
      if (!definition) return sourceError("artifact supplement count changed");
      exactKeys(value, [
        "recordType",
        "key",
        "queryFields",
        "expectedCount",
      ], `artifact supplement ${supplementIndex + 1}`);
      expectedCount = definition.categories.reduce(
        (sum, category) => sum + (categories[category] || 0),
        0,
      );
      if (
        value.key !== definition.key
        || JSON.stringify(value.queryFields) !== JSON.stringify(definition.fields)
        || value.expectedCount !== expectedCount
      ) {
        return sourceError(`artifact supplement ${definition.key} control changed`);
      }
      decodedCount = 0;
      expectedAfterId = null;
      terminalSeen = expectedCount === 0;
      continue;
    }
    if (value.recordType !== "supplement-page") continue;
    if (!definition || terminalSeen) {
      return sourceError("artifact supplement page is out of sequence");
    }
    exactKeys(value, [
      "recordType",
      "key",
      "afterId",
      "response",
    ], `artifact supplement ${definition.key} page`);
    if (value.key !== definition.key || value.afterId !== expectedAfterId) {
      return sourceError(`artifact supplement ${definition.key} cursor changed`);
    }
    const fieldTypes = definition.fields.map((field) => (
      CREDITEX_VEU_DIM_PRODUCT_SCHEMA[
        field as keyof typeof CREDITEX_VEU_DIM_PRODUCT_SCHEMA
      ][0]
    ));
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(value.response, `artifact supplement ${definition.key} response`, 4_000_000),
      definition.fields,
      fieldTypes,
      CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE,
    );
    const allowedCategories = new Set<string>(definition.categories);
    let batch: CreditexOfficialProductStreamValue[] = [];
    for (const row of decoded.rows) {
      const id = requiredRowText(row[0], `supplement ${definition.key} Id`);
      const productId = requiredRowText(row[1], `supplement ${definition.key} Product ID`);
      const category = optionalRowText(row[2], `supplement ${definition.key} category`);
      const sourceStatus = requiredRowText(row[3], `supplement ${definition.key} status`);
      if (
        (expectedAfterId && id.toLowerCase() <= expectedAfterId.toLowerCase())
        || !allowedCategories.has(category)
        || (sourceStatus !== "Approved" && sourceStatus !== "Legacy")
        || (
          "productIds" in definition
          && !(definition.productIds as readonly string[]).includes(productId)
        )
      ) {
        return sourceError(`supplement ${definition.key} identity changed`);
      }
      expectedAfterId = id;
      batch.push({
        sourceRecordKey: id,
        value: {
          productId,
          category,
          sourceStatus,
          definitionIndex: supplementIndex,
          values: row.slice(4),
        },
      });
      decodedCount += 1;
      if (decodedCount > expectedCount) {
        return sourceError(`artifact supplement ${definition.key} exceeded its control`);
      }
      if (batch.length === CREDITEX_VEU_STREAM_BATCH_SIZE) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) yield batch;
    terminalSeen = !decoded.continuation;
  }
  finishCurrent();
  if (supplementIndex + 1 !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length) {
    return sourceError("artifact supplement count changed");
  }
}

function* creditexVeuSupplementalBatches(
  bytes: Uint8Array,
  contentType: string,
): Generator<readonly CreditexOfficialProductStreamValue[]> {
  if (contentType !== "application/json") {
    return sourceError("artifact content type changed");
  }
  const metadata = creditexVeuStreamHeader(bytes);
  const { categories } = metadata;
  if (metadata.contract === CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT) {
    yield* creditexVeuBoundedSupplementalBatches(bytes, categories);
    return;
  }
  let supplementIndex = 0;
  for (const { value } of veuStreamLines(bytes)) {
    if (value.recordType !== "supplement") continue;
    const definition = CREDITEX_VEU_SUPPLEMENTAL_QUERIES[supplementIndex];
    if (!definition) return sourceError("artifact supplement count changed");
    exactKeys(value, [
      "recordType",
      "key",
      "queryFields",
      "expectedCount",
      "pages",
    ], `artifact supplement ${supplementIndex + 1}`);
    const expectedCount = definition.categories.reduce(
      (sum, category) => sum + (categories[category] || 0),
      0,
    );
    if (
      value.key !== definition.key
      || JSON.stringify(value.queryFields) !== JSON.stringify(definition.fields)
      || value.expectedCount !== expectedCount
    ) {
      return sourceError(`artifact supplement ${definition.key} control changed`);
    }
    const pages = requiredArray(value.pages, `artifact supplement ${definition.key} pages`);
    if (
      pages.length > 200
      || (expectedCount === 0 ? pages.length !== 0 : pages.length < 1)
    ) {
      return sourceError(`artifact supplement ${definition.key} page count changed`);
    }
    const fieldTypes = definition.fields.map((field) => (
      CREDITEX_VEU_DIM_PRODUCT_SCHEMA[
        field as keyof typeof CREDITEX_VEU_DIM_PRODUCT_SCHEMA
      ][0]
    ));
    const allowedCategories = new Set<string>(definition.categories);
    let expectedAfterId: string | null = null;
    let terminalSeen = expectedCount === 0;
    let decodedCount = 0;
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = requiredObject(
        pages[pageIndex],
        `artifact supplement ${definition.key} page ${pageIndex + 1}`,
      );
      exactKeys(page, ["afterId", "response"], `artifact supplement ${definition.key} page`);
      if (page.afterId !== expectedAfterId || terminalSeen) {
        return sourceError(`artifact supplement ${definition.key} cursor changed`);
      }
      const decoded = decodeCreditexVeuPowerBiProductPage(
        requiredText(page.response, `artifact supplement ${definition.key} response`, 4_000_000),
        definition.fields,
        fieldTypes,
        CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE,
      );
      let batch: CreditexOfficialProductStreamValue[] = [];
      for (const row of decoded.rows) {
        const id = requiredRowText(row[0], `supplement ${definition.key} Id`);
        const productId = requiredRowText(row[1], `supplement ${definition.key} Product ID`);
        const category = optionalRowText(row[2], `supplement ${definition.key} category`);
        const sourceStatus = requiredRowText(row[3], `supplement ${definition.key} status`);
        if (
          (expectedAfterId && id.toLowerCase() <= expectedAfterId.toLowerCase())
          || !allowedCategories.has(category)
          || (sourceStatus !== "Approved" && sourceStatus !== "Legacy")
          || (
            "productIds" in definition
            && !(definition.productIds as readonly string[]).includes(productId)
          )
        ) {
          return sourceError(`supplement ${definition.key} identity changed`);
        }
        expectedAfterId = id;
        batch.push({
          sourceRecordKey: id,
          value: {
            productId,
            category,
            sourceStatus,
            definitionIndex: supplementIndex,
            values: row.slice(4),
          },
        });
        decodedCount += 1;
        if (batch.length === CREDITEX_VEU_STREAM_BATCH_SIZE) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
      terminalSeen = !decoded.continuation;
      if (pageIndex < pages.length - 1 && terminalSeen) {
        return sourceError(`artifact supplement ${definition.key} ended early`);
      }
    }
    if (!terminalSeen || decodedCount !== expectedCount) {
      return sourceError(`artifact supplement ${definition.key} did not reconcile`);
    }
    supplementIndex += 1;
  }
  if (supplementIndex !== CREDITEX_VEU_SUPPLEMENTAL_QUERIES.length) {
    return sourceError("artifact supplement count changed");
  }
}

function inspectCreditexVeuStreamProductArtifact(
  bytes: Uint8Array,
  contentType: string,
) {
  if (contentType !== "application/json") {
    return sourceError("artifact content type changed");
  }
  const {
    total,
    statuses,
    categories,
    pageCount,
  } = creditexVeuStreamHeader(bytes);
  for (const batch of creditexVeuSupplementalBatches(bytes, contentType)) {
    // Exhausting the generator validates every supplemental page without
    // retaining the registry-wide supplemental graph in Worker memory.
    if (batch.length > CREDITEX_VEU_STREAM_BATCH_SIZE) {
      return sourceError("supplemental artifact batch exceeded the memory bound");
    }
  }
  const derivedStatuses: Record<string, number> = { Approved: 0, Legacy: 0 };
  const derivedCategories: Record<string, number> = Object.fromEntries(
    Object.keys(categories).map((key) => [key, 0]),
  );
  let expectedAfterId: string | null = null;
  let terminalSeen = false;
  let decodedPageCount = 0;
  let recordCount = 0;
  for (const { value } of veuStreamLines(bytes)) {
    if (value.recordType !== "page") continue;
    exactKeys(value, ["recordType", "afterId", "response"], "artifact page");
    decodedPageCount += 1;
    if (value.afterId !== expectedAfterId || terminalSeen) {
      return sourceError(`artifact page ${decodedPageCount} cursor changed`);
    }
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(value.response, `artifact page ${decodedPageCount} response`, 4_000_000),
      CREDITEX_VEU_QUERY_FIELDS,
      CREDITEX_VEU_QUERY_FIELD_TYPES,
      CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE,
    );
    for (const row of decoded.rows) {
      const id = requiredRowText(row[0], "page Salesforce Id");
      if (expectedAfterId && id.toLowerCase() <= expectedAfterId.toLowerCase()) {
        return sourceError("product pagination is not strictly monotonic");
      }
      expectedAfterId = id;
      const category = optionalRowText(row[3], "page category");
      const status = requiredRowText(row[7], "page status");
      if (!(status in derivedStatuses) || !(category in derivedCategories)) {
        return sourceError("decoded row is outside aggregate controls");
      }
      derivedStatuses[status] += 1;
      derivedCategories[category] += 1;
      recordCount += 1;
    }
    terminalSeen = !decoded.continuation;
    if (decodedPageCount < pageCount && terminalSeen) {
      return sourceError("artifact completed before its last page");
    }
  }
  if (
    decodedPageCount !== pageCount
    || recordCount !== total
    || !terminalSeen
    || JSON.stringify(derivedStatuses) !== JSON.stringify(statuses)
    || JSON.stringify(derivedCategories) !== JSON.stringify(categories)
  ) {
    return sourceError("stream artifact records did not reconcile");
  }
  return recordCount;
}

async function* creditexVeuRecordBatches(
  bytes: Uint8Array,
  contentType: string,
  loadValues: (
    sourceRecordKeys: readonly string[],
  ) => Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>,
  resume?: Readonly<{
    afterRecordCount: number;
    afterSourceRecordKey: string;
    maximumBatches: number;
  }>,
): AsyncGenerator<readonly CreditexOfficialProductRecord[]> {
  const expectedTotal = inspectCreditexVeuStreamProductArtifact(bytes, contentType);
  const afterRecordCount = resume?.afterRecordCount ?? 0;
  const afterSourceRecordKey = resume?.afterSourceRecordKey ?? "";
  const maximumBatches = resume?.maximumBatches;
  if (
    !Number.isSafeInteger(afterRecordCount)
    || afterRecordCount < 0
    || afterRecordCount > expectedTotal
    || (
      afterRecordCount === 0
        ? afterSourceRecordKey !== ""
        : (
          typeof afterSourceRecordKey !== "string"
          || afterSourceRecordKey.length < 1
          || afterSourceRecordKey.length > 500
        )
    )
    || (
      resume !== undefined
      && (
        !Number.isSafeInteger(maximumBatches)
        || Number(maximumBatches) < 1
        || Number(maximumBatches) > CREDITEX_VEU_STREAM_MAXIMUM_RESUME_BATCHES
      )
    )
  ) {
    return sourceError("stream artifact resume cursor is invalid");
  }
  let recordIndex = 0;
  let checkpointVerified = afterRecordCount === 0;
  let yieldedBatchCount = 0;
  for (const { value } of veuStreamLines(bytes)) {
    if (value.recordType !== "page") continue;
    const decoded = decodeCreditexVeuPowerBiProductPage(
      requiredText(value.response, "artifact page response", 4_000_000),
      CREDITEX_VEU_QUERY_FIELDS,
      CREDITEX_VEU_QUERY_FIELD_TYPES,
      CREDITEX_VEU_LEGACY_STREAM_PAGE_SIZE,
    );
    for (let offset = 0; offset < decoded.rows.length; offset += CREDITEX_VEU_STREAM_BATCH_SIZE) {
      const pageRows = decoded.rows.slice(
        offset,
        offset + CREDITEX_VEU_STREAM_BATCH_SIZE,
      );
      const batchStart = recordIndex;
      recordIndex += pageRows.length;
      if (!checkpointVerified && afterRecordCount <= recordIndex) {
        const checkpointOffset = afterRecordCount - batchStart - 1;
        const checkpointRow = pageRows[checkpointOffset];
        if (
          !checkpointRow
          || requiredRowText(
            checkpointRow[1],
            "stream artifact resume product ID",
          ) !== afterSourceRecordKey
        ) {
          return sourceError("stream artifact resume cursor changed");
        }
        checkpointVerified = true;
      }
      if (recordIndex <= afterRecordCount) continue;
      const rows = batchStart < afterRecordCount
        ? pageRows.slice(afterRecordCount - batchStart)
        : pageRows;
      const ids = rows.map((row) => requiredRowText(row[0], "page Salesforce Id"));
      const values = await loadValues(ids);
      const records = rows.map((row, rowOffset) => {
        const id = requiredRowText(row[0], "page Salesforce Id");
        const rawSupplement = values.get(id);
        const supplement = rawSupplement
          ? rawSupplement as unknown as VeuSupplementalRecord
          : undefined;
        return productRecord(
          row,
          batchStart + (pageRows.length - rows.length) + rowOffset + 1,
          supplement,
        );
      });
      yield records;
      yieldedBatchCount += 1;
      if (
        maximumBatches !== undefined
        && yieldedBatchCount >= maximumBatches
      ) {
        return;
      }
    }
  }
  if (!checkpointVerified || recordIndex !== expectedTotal) {
    return sourceError("stream artifact replay count changed");
  }
}

export const CREDITEX_VEU_STREAMING_PARSER = {
  inspect: inspectCreditexVeuStreamProductArtifact,
  supplementalBatches: creditexVeuSupplementalBatches,
  recordBatches: creditexVeuRecordBatches,
} as const satisfies CreditexOfficialProductStreamingParser;

export function parseCreditexVeuProductArtifact(
  bytes: Uint8Array,
  contentType: string,
): readonly CreditexOfficialProductRecord[] {
  if (contentType !== "application/json") {
    return sourceError("artifact content type changed");
  }
  const firstLineEnd = bytes.indexOf(10);
  if (firstLineEnd > 0) {
    let firstLine: unknown;
    try {
      firstLine = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, firstLineEnd),
      )) as unknown;
    } catch {
      return sourceError("stream artifact header is invalid");
    }
    if (
      isObject(firstLine)
      && (
        firstLine.contract === CREDITEX_VEU_STREAM_ARTIFACT_CONTRACT
        || firstLine.contract === CREDITEX_VEU_BOUNDED_STREAM_ARTIFACT_CONTRACT
      )
    ) {
      return parseCreditexVeuStreamProductArtifact(bytes);
    }
  }
  return parseCreditexVeuLegacyProductArtifact(bytes, contentType);
}
