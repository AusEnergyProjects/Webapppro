import {
  governmentActivityTemplates,
  type GovernmentActivityTemplate,
} from "../lib/australian-government-program-catalogue.ts";
import {
  governmentActivityCalculationMethods,
  type CertificateCalculationState,
} from "../lib/australian-certificate-calculation-catalogue.ts";

export const CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA =
  "creditex-sres-work-pack-content/v1" as const;

export const CREDITEX_CURRENT_SRES_ACTIVITY_CODES = [
  "PV",
  "BESS",
  "WIND",
  "HYDRO",
  "SWH",
  "ASHP",
] as const;

export type CreditexCurrentSresActivityCode =
  (typeof CREDITEX_CURRENT_SRES_ACTIVITY_CODES)[number];

type SresSourceKey =
  | "systems"
  | "createStcs"
  | "calculateStcs"
  | "complianceActivities"
  | "act"
  | "regulations"
  | "sguMandatoryInformation"
  | "pvAssignmentExample"
  | "pvModulesCsv"
  | "invertersCsv"
  | "batteriesCsv"
  | "batteryAssignmentExample"
  | "batteryPhotoGuide"
  | "batteryInspectionChecklist"
  | "batteryInstallersDesigners"
  | "batteryBulkFieldsPage"
  | "swhMandatoryInformation"
  | "swhRegisterPage"
  | "swhRegisterRelease"
  | "ashpModelsCsv"
  | "swhUnder700ModelsCsv"
  | "swhOver700ModelsCsv"
  | "pvPostcodeZones"
  | "waterHeaterPostcodeZones"
  | "swhMethod"
  | "registryBulkUploadGuide"
  | "swhOwnerStatutoryDeclaration"
  | "swhSizeStatutoryDeclaration";

export type CreditexSresOfficialSource = {
  sourceId: string;
  expectedSha256: string;
  title: string;
  version: string;
  officialUrl: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  statedEffectiveDate: string | null;
  observedOn: "2026-08-15";
  pendingIndependentCreditexReview: true;
  operationallyApproved: false;
};

export type CreditexSresSourceBinding = CreditexSresOfficialSource & {
  citation: string;
};

function officialSource<const T extends Omit<
  CreditexSresOfficialSource,
  "observedOn" | "pendingIndependentCreditexReview" | "operationallyApproved"
>>(source: T): T & Pick<
  CreditexSresOfficialSource,
  "observedOn" | "pendingIndependentCreditexReview" | "operationallyApproved"
> {
  return {
    ...source,
    observedOn: "2026-08-15",
    pendingIndependentCreditexReview: true,
    operationallyApproved: false,
  };
}

export const CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY = {
  systems: officialSource({
    sourceId: "source-f5dcc1cee1e0e0ad9613",
    expectedSha256: "4b2a4a1a0c1f6ebfc4ab7604c4c3d0cb53c4d76258e4cdeabbdf79edbdc78667",
    title: "CER small scale renewable energy systems",
    version: "",
    officialUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems",
    expectedContentType: "text/html",
    expectedSizeBytes: 177_914,
    statedEffectiveDate: null,
  }),
  createStcs: officialSource({
    sourceId: "source-c5a079ba4faca2b6d714",
    expectedSha256: "f4c77444e8dd9af8f605b8a1e49b6d500e10fa2c51febed1d3828755e79f3030",
    title: "Create small-scale technology certificates | Clean Energy Regulator",
    version: "",
    officialUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates",
    expectedContentType: "text/html",
    expectedSizeBytes: 175_030,
    statedEffectiveDate: null,
  }),
  calculateStcs: officialSource({
    sourceId: "source-ee6738e2680c595794e5",
    expectedSha256: "32bb4b6bad8db5f9fd31e27d84adcacc82fee9079efbc9dc6ac408e0a4dc034c",
    title: "Calculate small-scale technology certificate entitlements | Clean Energy Regulator",
    version: "",
    officialUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements",
    expectedContentType: "text/html",
    expectedSizeBytes: 159_775,
    statedEffectiveDate: null,
  }),
  complianceActivities: officialSource({
    sourceId: "source-502333cb6dfb4537ef2c",
    expectedSha256: "185a56a40f2c8d067f07b72d74e33f9a81f6211e679f78a23792888121195e7f",
    title: "CER SRES compliance activities",
    version: "",
    officialUrl: "https://cer.gov.au/about-us/our-compliance-approach/sres-compliance-activities",
    expectedContentType: "text/html",
    expectedSizeBytes: 155_123,
    statedEffectiveDate: null,
  }),
  act: officialSource({
    sourceId: "source-7991f72d53d52ab8f136",
    expectedSha256: "478e7735d8e4cd89c988bcd7f7e2eac316fd09c831796eab3c5e92c760309343",
    title: "Renewable Energy (Electricity) Act 2000",
    version: "Compilation No. 34",
    officialUrl: "https://www.legislation.gov.au/C2004A00767/2026-01-01/2026-01-01/text/original/pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 933_705,
    statedEffectiveDate: "2026-01-01",
  }),
  regulations: officialSource({
    sourceId: "source-477dafdde6e415e934ba",
    expectedSha256: "1926144f85f5049b1382a1e32ac31f1a530f43cc4f6e2a83a50eeea668937f5a",
    title: "Renewable Energy (Electricity) Regulations 2001",
    version: "Compilation No. 90",
    officialUrl: "https://www.legislation.gov.au/F2001B00053/2026-05-01/2026-05-01/text/original/pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1_697_039,
    statedEffectiveDate: "2026-05-01",
  }),
  sguMandatoryInformation: officialSource({
    sourceId: "source-b3a0b61ba84104b2a4b7",
    expectedSha256: "61e075852f1907d450b9eed1f204d7f61c85addf3cfbb7a7c1432642e62bc904",
    title: "CER SGU mandatory information to create STCs",
    version: "",
    officialUrl: "https://cer.gov.au/document/sgu-collecting-mandatory-information-to-create-stcs",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 453_292,
    statedEffectiveDate: null,
  }),
  pvAssignmentExample: officialSource({
    sourceId: "source-50b61a941eebdd6fd80f",
    expectedSha256: "3610a4f12bd154d4920fc7580541bdd94caf2830bcea70d7524b711866669c53",
    title: "CER sample STC assignment form and compulsory written statements",
    version: "",
    officialUrl: "https://cer.gov.au/document/sample-stc-assignment-form-and-compulsory-written-statements",
    expectedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    expectedSizeBytes: 53_844,
    statedEffectiveDate: null,
  }),
  pvModulesCsv: officialSource({
    sourceId: "source-6aae6ff88994e89c7a4b",
    expectedSha256: "09601faecb2a8895576f5d0fa9ad83c96dfe58b4f4bafeec444eaf6ee74649bd",
    title: "CER approved PV modules",
    version: "",
    officialUrl: "https://cer.gov.au/document/cec-approved-pv-modules-0",
    expectedContentType: "text/csv",
    expectedSizeBytes: 397_054,
    statedEffectiveDate: null,
  }),
  invertersCsv: officialSource({
    sourceId: "source-664e16f3e401a18c58b1",
    expectedSha256: "7ecc0443a0aa85cfcc1acf3d2a0e736c799a83dbfd2a0fc4b783fa11713de738",
    title: "CER approved inverters",
    version: "",
    officialUrl: "https://cer.gov.au/document/cec-approved-inverters-0",
    expectedContentType: "text/csv",
    expectedSizeBytes: 506_596,
    statedEffectiveDate: null,
  }),
  batteriesCsv: officialSource({
    sourceId: "source-680f9ef2fc23be4121fb",
    expectedSha256: "155701760bf5af524fcb8e35615392a0041cb00737d6ea04677d6b9f3a87ae75",
    title: "CER approved solar batteries",
    version: "",
    officialUrl: "https://cer.gov.au/document/cec-approved-solar-batteries-0",
    expectedContentType: "text/csv",
    expectedSizeBytes: 430_301,
    statedEffectiveDate: null,
  }),
  batteryAssignmentExample: officialSource({
    sourceId: "source-fb8e84c79239963ed676",
    expectedSha256: "fd5ab46c38473a683c902d0e20aedce7ad665edf66b4a93c629f72a61e47f449",
    title: "CER sample STC assignment form solar battery",
    version: "",
    officialUrl: "https://cer.gov.au/document/sample-small-scale-technology-certificate-assignment-form-solar-battery-systems",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 306_874,
    statedEffectiveDate: null,
  }),
  batteryPhotoGuide: officialSource({
    sourceId: "source-d30db595d1cba54967ab",
    expectedSha256: "daf9a0354e5539dcf751a1c06fbec8c0630b4f432f6daf67c815552956bcdd63",
    title: "CER solar battery photo guide",
    version: "",
    officialUrl: "https://cer.gov.au/document/solar-battery-photo-guide",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 741_069,
    statedEffectiveDate: null,
  }),
  batteryInspectionChecklist: officialSource({
    sourceId: "source-4deba5bed2c77a2f78d9",
    expectedSha256: "d47c1753bcd0225c36d43d109c9f29e1f6b71f67fa37e254d4d198d99323eeb1",
    title: "CER solar battery inspection checklist",
    version: "",
    officialUrl: "https://cer.gov.au/document/solar-battery-inspection-checklist-0",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 695_670,
    statedEffectiveDate: null,
  }),
  batteryInstallersDesigners: officialSource({
    sourceId: "source-687f0c7bbe39ead1c5a0",
    expectedSha256: "dd158d7a27e404c02dbdd2bb6723b5516ea7f8dba8281616b0188ac255a7efa7",
    title: "CER solar battery installers and designers",
    version: "",
    officialUrl: "https://cer.gov.au/schemes/renewable-energy-target/renewable-energy-target-participants-and-industry/solar-battery-installers-and-designers",
    expectedContentType: "text/html",
    expectedSizeBytes: 158_431,
    statedEffectiveDate: null,
  }),
  batteryBulkFieldsPage: officialSource({
    sourceId: "source-38013209c6680c5dded9",
    expectedSha256: "0ffa1b49ef2eb435f78190ee16de9c62a9d25c6e9b12419ad15f7b51a17a6604",
    title: "CER required fields solar battery bulk upload",
    version: "",
    officialUrl: "https://cer.gov.au/document_page/required-fields-solar-battery-bulk-upload",
    expectedContentType: "text/html",
    expectedSizeBytes: 140_453,
    statedEffectiveDate: null,
  }),
  swhMandatoryInformation: officialSource({
    sourceId: "source-77d567a5824c9c431856",
    expectedSha256: "1bc518550535613d4429e575ed141a597efc48a94e416a51da1a48d5f6c081fa",
    title: "CER SWH mandatory information to create STCs",
    version: "",
    officialUrl: "https://cer.gov.au/document/swh-collecting-mandatory-information-to-create-stcs",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 317_358,
    statedEffectiveDate: null,
  }),
  swhRegisterPage: officialSource({
    sourceId: "source-8d5df949063db673f2a4",
    expectedSha256: "700982c40c8e8f37d0e87eadb31706ffa8223b0ce1ae13e1d437b89eff2aff1f",
    title: "CER register solar water heaters",
    version: "",
    officialUrl: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters",
    expectedContentType: "text/html",
    expectedSizeBytes: 9_302_032,
    statedEffectiveDate: null,
  }),
  swhRegisterRelease: officialSource({
    sourceId: "source-82ecac420a35f04eafec",
    expectedSha256: "a39fb848dbba1a261a21b8f3f4936d7c1f8d8b639f527e5d473749155d210c81",
    title: "Register of solar water heaters Version 58 release",
    version: "Version 58",
    officialUrl: "https://cer.gov.au/news-and-media/news/2026/august/register-solar-water-heaters-version-58-now-available",
    expectedContentType: "text/html",
    expectedSizeBytes: 133_124,
    statedEffectiveDate: null,
  }),
  ashpModelsCsv: officialSource({
    sourceId: "source-242c900a17c47a924ad3",
    expectedSha256: "b764b58c6717a82563da6db498e03c9e63940de35865e483f6395e33ac12916b",
    title: "CER air source heat pump models",
    version: "",
    officialUrl: "https://cer.gov.au/document/air-source-heat-pump-models",
    expectedContentType: "text/csv",
    expectedSizeBytes: 80_423,
    statedEffectiveDate: null,
  }),
  swhUnder700ModelsCsv: officialSource({
    sourceId: "source-d01b67329903121f8613",
    expectedSha256: "c93c34b33011f0688d09cdb9278f563a782c06464ddb9abed96aa870b6078c9b",
    title: "CER solar water heater models less than 700L",
    version: "",
    officialUrl: "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l",
    expectedContentType: "text/csv",
    expectedSizeBytes: 443_557,
    statedEffectiveDate: null,
  }),
  swhOver700ModelsCsv: officialSource({
    sourceId: "source-036be1140e14a3481a60",
    expectedSha256: "95162d637f75ae5b94b1a687c262f503c897607f5143ba03a1f3bc88b3659903",
    title: "CER solar water heater models more than 700L",
    version: "",
    officialUrl: "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l",
    expectedContentType: "text/csv",
    expectedSizeBytes: 679_454,
    statedEffectiveDate: null,
  }),
  pvPostcodeZones: officialSource({
    sourceId: "source-09abe9eb5e63b2d635c7",
    expectedSha256: "58cd05502692011b22b314f48be673e80a74e7775d569aa2989a956968dc72e3",
    title: "CER postcode zone ratings solar panel systems",
    version: "",
    officialUrl: "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 176_553,
    statedEffectiveDate: null,
  }),
  waterHeaterPostcodeZones: officialSource({
    sourceId: "source-a3a1f82e1a2bfdb84bb3",
    expectedSha256: "eddfe37821c6beb69d58c81c4bee92c061f5b80f29746fefbeb3c123c03de1ec",
    title: "CER postcode zones solar water heaters and heat pumps",
    version: "",
    officialUrl: "https://cer.gov.au/document/postcode-zones-solar-water-heaters-and-heat-pumps",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 221_188,
    statedEffectiveDate: null,
  }),
  swhMethod: officialSource({
    sourceId: "source-0d9e73b4095ad5ecfd7a",
    expectedSha256: "42cf0f24a2d5791b4e6bfe52ba59bc8044b14ca176714fb20f83cadfe3dfa243",
    title: "Renewable Energy (Electricity) Method for Solar Water Heaters Determination 2016",
    version: "Compilation No. 2",
    officialUrl: "https://www.legislation.gov.au/F2017L00028/2022-01-01/2022-01-01/text/original/pdf",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 1_012_482,
    statedEffectiveDate: "2022-01-01",
  }),
  registryBulkUploadGuide: officialSource({
    sourceId: "source-0624345e38a20068320a",
    expectedSha256: "783d8b54f37a1c7a189d3de5c38b69057e8e574077abfeea550861a1a6dc39de",
    title: "CER REC Registry bulk upload guide",
    version: "",
    officialUrl: "https://cer.gov.au/document/rec-registry-guide-bulk-upload-small-generation-unit-and-solar-water-heater-installs",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 963_322,
    statedEffectiveDate: null,
  }),
  swhOwnerStatutoryDeclaration: officialSource({
    sourceId: "source-37341b00f2c3e12ff019",
    expectedSha256: "b4b34b79cdf09856e50747190c3254e3815ab6abb91578efac31d59e136134dc",
    title: "CER statutory declaration 1",
    version: "",
    officialUrl: "https://cer.gov.au/document/statutory-declaration-1-1210",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 111_742,
    statedEffectiveDate: null,
  }),
  swhSizeStatutoryDeclaration: officialSource({
    sourceId: "source-e84b93a20d5680b9335b",
    expectedSha256: "b70e5de16d708ea26fdeb7536ae73b5ca90af8871c8ab42ff28e2e81d4afaaf6",
    title: "CER statutory declaration 2",
    version: "",
    officialUrl: "https://cer.gov.au/document/statutory-declaration-2-1210",
    expectedContentType: "application/pdf",
    expectedSizeBytes: 116_427,
    statedEffectiveDate: null,
  }),
} as const satisfies Record<SresSourceKey, CreditexSresOfficialSource>;

function citation(
  sourceKey: SresSourceKey,
  exactCitation: string,
): CreditexSresSourceBinding {
  return {
    ...CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY[sourceKey],
    citation: exactCitation,
  };
}

export type CreditexSresPromptRequirement = {
  key: string;
  label: string;
  kind:
    | "identity"
    | "assignment"
    | "installation"
    | "eligibility"
    | "product"
    | "calculation"
    | "declaration";
  required: boolean;
  valueSource:
    | "job"
    | "creditex_registered_agent"
    | "assigned_trade_business"
    | "assigned_trade_technician"
    | "operator"
    | "official_product_snapshot"
    | "official_postcode_lookup"
    | "derived_from_formula";
  fields: readonly string[];
  when: string;
  source: CreditexSresSourceBinding;
};

export type CreditexSresEvidenceRequirement = {
  requirementId: string;
  kind:
    | "geotagged_photograph"
    | "signed_statement"
    | "certificate"
    | "invoice"
    | "statutory_declaration"
    | "technical_report"
    | "registry_record";
  label: string;
  details: readonly string[];
  when: string;
  required: boolean;
  alternativeGroup?: {
    groupId: string;
    minimumRequired: 1;
  };
  preserveOriginalMetadata: boolean;
  source: CreditexSresSourceBinding;
};

export type CreditexSresProductDependency = {
  productKind:
    | "cec_approved_pv_module_csv"
    | "cec_approved_inverter_csv"
    | "cec_approved_solar_battery_csv"
    | "cer_swh_under_700l_register_csv"
    | "cer_swh_over_700l_register_csv"
    | "cer_ashp_register_csv"
    | "wind_or_hydro_equipment_identity";
  applicability: "required" | "required_if_inverter_used" | "conditional_by_capacity";
  registrySnapshotRequired: boolean;
  eligibilityDateKey: string | null;
  requiredSnapshotFields: readonly string[];
  source: CreditexSresSourceBinding;
};

export type CreditexSresSignatureRequirement = {
  signatureId: string;
  documentType: string;
  signerRole:
    | "system_owner"
    | "owner_witness"
    | "installer"
    | "installer_witness"
    | "designer"
    | "designer_witness"
    | "retailer_representative"
    | "retailer_witness"
    | "installer_compliance_signatory"
    | "statutory_declarant"
    | "authorised_statutory_witness";
  required: boolean;
  when: string;
  visibleSignatureBox: true;
  autofillIntoFinalPdf: true;
  source: CreditexSresSourceBinding;
};

export type CreditexSresFinalDocumentNeed = {
  documentType: string;
  label: string;
  required: boolean;
  when: string;
  format: "pdf" | "original_evidence" | "external_record";
  immutableAfterFinalisation: true;
  source: CreditexSresSourceBinding;
};

export type CreditexSresWorkPackGapCode =
  | "SRES_INDEPENDENT_CREDITEX_REVIEW_REQUIRED"
  | "SRES_REC_REGISTRY_CURRENT_SUBMISSION_SCHEMA_MISSING"
  | "SRES_CURRENT_DECLARATION_SNAPSHOT_CONNECTOR_MISSING"
  | "SRES_CURRENT_PRODUCT_RECALL_CONNECTOR_MISSING"
  | "SRES_OFFICIAL_CALCULATOR_GOLDEN_VECTORS_MISSING"
  | "SRES_REGISTERED_AGENT_ACCOUNT_AND_ASSIGNMENT_NOT_VERIFIED"
  | "SRES_APPROVED_COMPONENT_SNAPSHOT_CONNECTOR_MISSING"
  | "SRES_ACCREDITATION_SNAPSHOT_CONNECTOR_MISSING"
  | "SRES_WIND_HYDRO_ASSIGNMENT_FORM_TEMPLATE_MISSING"
  | "SRES_WIND_HYDRO_SITE_AUDIT_TEMPLATE_MISSING"
  | "SRES_WATER_HEATER_ASSIGNMENT_FORM_TEMPLATE_MISSING"
  | "SRES_BATTERY_BULK_UPLOAD_WORKBOOK_MISSING"
  | "SRES_BATTERY_ONE_CLAIM_PER_ADDRESS_CHECK_MISSING"
  | "SRES_BATTERY_PRE_2025_REPLACEMENT_EXPANSION_CONTRACT_MISSING"
  | "SRES_BATTERY_INSTALLER_DAILY_LIMIT_CONNECTOR_MISSING";

export type CreditexSresWorkPackContentCandidate = {
  schema: typeof CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA;
  programCode: "SRES";
  templateId: string;
  activityCode: CreditexCurrentSresActivityCode;
  title: string;
  catalogueState: "current" | "limited";
  statusDecision: {
    state: "current" | "limited";
    activityEffectiveFrom: string | null;
    effectiveTo: null;
    sourceBackedLimitations: readonly string[];
    source: CreditexSresSourceBinding;
  };
  identityBindings: {
    registeredAgent: "creditex_provider_for_job";
    systemOwner: "job_system_owner_or_authorised_signatory";
    installerBusiness: "assigned_trade_business_for_job";
    assignedTechnician: "assigned_trade_technician_for_appointment";
    installerIndividual: "captured_individual_installer_for_system";
    designerIndividual:
      | "captured_individual_designer_for_system"
      | "not_required_by_activity_source";
    electricianIndividual:
      | "captured_individual_electrician_for_system"
      | "not_required_by_activity_source";
    retailerLegalEntity:
      | "captured_selling_legal_entity_for_system"
      | "not_required_by_activity_source";
  };
  sourceBindings: readonly CreditexSresSourceBinding[];
  prompts: readonly CreditexSresPromptRequirement[];
  evidenceRequirements: readonly CreditexSresEvidenceRequirement[];
  productDependencies: readonly CreditexSresProductDependency[];
  postcodeZoneRule: {
    postcodeRequired: true;
    zoneApplicability:
      | "solar_pv_zone_rating_required"
      | "water_heater_zone_required"
      | "not_used_in_certificate_arithmetic";
    zoneCount: 0 | 4 | 5;
    ratingValues: readonly string[];
    source: CreditexSresSourceBinding;
  };
  deemingRule: {
    applicability:
      | "one_five_or_maximum_period"
      | "one_or_current_maximum_period"
      | "registered_ten_year_entitlement_multiplier"
      | "not_applicable_battery_date_factor";
    installationYears: readonly number[];
    sourceOptions: readonly string[];
    source: CreditexSresSourceBinding;
  };
  scenarioRules: {
    officialScenarioCode: null;
    classification: "no_separate_scenario_code_use_source_options";
    sourceOptions: readonly string[];
    source: CreditexSresSourceBinding;
  };
  calculator: {
    outputUnit: "STC";
    formulaKey: string;
    formulaSummary: string;
    inputKeys: readonly string[];
    existingCatalogueState: CertificateCalculationState;
    runtimeEstimatorContract: "creditex-stc-deterministic-estimate/v1";
    outputClassification: "runtime_estimate_only_registry_reconciliation_required";
    catalogueQuantity: null;
    officialReconciliationRequired: true;
    certificateActionEnabled: false;
    source: CreditexSresSourceBinding;
  };
  signatures: readonly CreditexSresSignatureRequirement[];
  referenceDocuments: readonly CreditexSresSourceBinding[];
  finalDocumentNeeds: readonly CreditexSresFinalDocumentNeed[];
  certificateOutput: {
    unit: "STC";
    classification: "tradable_certificate_after_regulator_registration";
    quantitySource: "runtime_validated_calculation_only";
    creationChannel: "rec_registry_registered_agent_workflow";
    localWorkPackMayCreateCertificate: false;
    source: CreditexSresSourceBinding;
  };
  gaps: readonly {
    code: CreditexSresWorkPackGapCode;
    blocksActivation: true;
    detail: string;
  }[];
  candidateOnly: true;
  independentlyApproved: false;
  published: false;
  activationReady: false;
};

const ACT_ASSIGNMENT = citation(
  "act",
  "Renewable Energy (Electricity) Act 2000, Compilation No. 34, ss 23AA-24 and 26; PDF pp. 45-57.",
);
const REGULATIONS_SGU = citation(
  "regulations",
  "Renewable Energy (Electricity) Regulations 2001, Compilation No. 90, regs 3(2), 19D, 20 and 20AC-20AI; PDF pp. 24 and 42-70.",
);
const REGULATIONS_SWH = citation(
  "regulations",
  "Renewable Energy (Electricity) Regulations 2001, Compilation No. 90, regs 3A and 19-19BE; PDF pp. 25 and 37-42.",
);
const SYSTEMS_CURRENT = citation(
  "systems",
  "CER, Small-scale renewable energy systems, last updated 14 August 2026, sections Types of small-scale renewable energy systems and New systems.",
);
const CREATE_COMMON = citation(
  "createStcs",
  "CER, Create small-scale technology certificates, last updated 10 August 2026, sections Before you create STCs, Required documents, Photo evidence and Registered agents.",
);
const CALCULATE_COMMON = citation(
  "calculateStcs",
  "CER, Calculate small-scale technology certificate entitlements, last updated 30 April 2026, sections How we calculate entitlements and Deeming period.",
);
const COMPLIANCE_CURRENT = citation(
  "complianceActivities",
  "CER, SRES compliance activities, last updated 13 July 2026, Declarations.",
);
const SGU_COMMON = citation(
  "sguMandatoryInformation",
  "CER, Small generation units: collecting mandatory information to create STCs for systems installed from 1 April 2022, February 2022, pp. 2-21.",
);
const PV_FORM = citation(
  "pvAssignmentExample",
  "CER, Sample STC Assignment form and compulsory written statements for solar PV systems, version 2.0, 14 February 2024, sections System owner details through Retailer written statement.",
);
const BATTERY_FORM = citation(
  "batteryAssignmentExample",
  "CER, Sample STC assignment form and compulsory written statements for solar battery systems, version 1.0, 25 June 2025, pp. 2-11.",
);
const BATTERY_PHOTOS = citation(
  "batteryPhotoGuide",
  "CER, Solar battery photo guide, version 1.2, June 2026, pp. 3-10.",
);
const SWH_FIELDS = citation(
  "swhMandatoryInformation",
  "CER, Guideline on solar water heaters: collecting mandatory information to create STCs, version 1.1, 25 January 2024, pp. 3-9.",
);

const COMMON_OWNER_PROMPT: CreditexSresPromptRequirement = {
  key: "system_owner_details",
  label: "System owner details",
  kind: "identity",
  required: true,
  valueSource: "job",
  fields: [
    "owner_type",
    "first_name",
    "last_name",
    "company_name",
    "acn",
    "abn",
    "position",
    "phone",
    "email",
    "postal_address",
  ],
  when: "always; corporate-only fields apply when the owner is a business",
  source: CREATE_COMMON,
};

const COMMON_AGENT_PROMPT: CreditexSresPromptRequirement = {
  key: "creditex_registered_agent_assignment",
  label: "Assignment of the owner's right to Creditex",
  kind: "assignment",
  required: true,
  valueSource: "creditex_registered_agent",
  fields: [
    "registered_agent_legal_entity_name",
    "rec_registry_account_name",
    "right_to_create_assigned_to_agent",
    "assigned_stc_activity",
    "financial_incentive",
  ],
  when: "Creditex is the registered agent creating STCs for the owner",
  source: CREATE_COMMON,
};

const COMMON_TRADE_PROMPT: CreditexSresPromptRequirement = {
  key: "trade_business_and_assigned_technician",
  label: "Assigned trade business and technician",
  kind: "identity",
  required: true,
  valueSource: "assigned_trade_business",
  fields: [
    "installer_business_legal_name",
    "installer_business_abn",
    "assigned_technician_identity",
  ],
  when: "always; this job assignment does not substitute for the separately captured installer, designer or electrician identities",
  source: CREATE_COMMON,
};

const COMMON_SITE_PROMPT: CreditexSresPromptRequirement = {
  key: "installation_site",
  label: "Physical installation site",
  kind: "installation",
  required: true,
  valueSource: "job",
  fields: [
    "address_lines",
    "suburb_or_city",
    "state_or_territory",
    "postcode",
    "property_type",
    "single_or_multi_story",
    "additional_location_information",
    "latitude",
    "longitude",
  ],
  when: "latitude and longitude are used where address details are limited",
  source: SGU_COMMON,
};

const PV_PROMPTS: readonly CreditexSresPromptRequirement[] = [
  COMMON_OWNER_PROMPT,
  COMMON_AGENT_PROMPT,
  COMMON_TRADE_PROMPT,
  COMMON_SITE_PROMPT,
  {
    key: "pv_installation_details",
    label: "Solar PV installation details",
    kind: "installation",
    required: true,
    valueSource: "operator",
    fields: [
      "installation_date",
      "nmi_if_nem_site",
      "complete_unit",
      "installation_type",
      "system_mounting_type",
      "grid_connection_type",
      "more_than_one_sgu_at_address",
      "previously_failed_accreditation_code_and_explanation_if_applicable",
    ],
    when: "always; conditional fields follow the selected answers",
    source: citation(
      "sguMandatoryInformation",
      "CER SGU mandatory information guide, February 2022, solar installation details, pp. 3-7 and installation address, pp. 15-16.",
    ),
  },
  {
    key: "pv_components",
    label: "Approved PV module and inverter component identities",
    kind: "product",
    required: true,
    valueSource: "official_product_snapshot",
    fields: [
      "rated_power_output_kw",
      "module_brand",
      "module_model",
      "panel_count",
      "panel_serial_numbers",
      "inverter_manufacturer",
      "inverter_series",
      "inverter_model_number",
      "inverter_count",
      "inverter_serial_numbers",
    ],
    when: "always; every distinct module and inverter model is captured",
    source: citation(
      "sguMandatoryInformation",
      "CER SGU mandatory information guide, February 2022, PV module, inverter, rated power and serial-number fields, pp. 4-6.",
    ),
  },
  {
    key: "pv_retailer",
    label: "Solar retailer legal entity and representative",
    kind: "identity",
    required: true,
    valueSource: "operator",
    fields: [
      "retailer_involved",
      "retailer_legal_entity_name",
      "retailer_abn",
      "retailer_representative_first_name",
      "retailer_representative_last_name",
      "retailer_representative_role",
      "installer_employee_or_subcontractor_status",
    ],
    when: "retailer details are mandatory when a retailer was involved; evidence of no retailer is retained otherwise",
    source: citation(
      "sguMandatoryInformation",
      "CER SGU mandatory information guide, February 2022, retailer fields, pp. 3-4 and retailer statements, pp. 7-8.",
    ),
  },
  {
    key: "pv_professionals",
    label: "Installer, designer and electrician identities",
    kind: "identity",
    required: true,
    valueSource: "assigned_trade_technician",
    fields: [
      "installer_name_contact_address_accreditation_number_and_type",
      "designer_name_contact_address_accreditation_number_and_type",
      "designer_same_as_installer",
      "electrician_name_contact_address_and_licence_number",
      "electrician_same_as_installer",
    ],
    when: "always",
    source: citation(
      "sguMandatoryInformation",
      "CER SGU mandatory information guide, February 2022, installer, electrician and designer details, pp. 17-21.",
    ),
  },
  {
    key: "pv_calculation_inputs",
    label: "PV entitlement inputs",
    kind: "calculation",
    required: true,
    valueSource: "derived_from_formula",
    fields: ["installation_date", "rated_capacity_kw", "postcode_zone_rating", "certificate_period"],
    when: "always",
    source: CALCULATE_COMMON,
  },
];

const BATTERY_PROMPTS: readonly CreditexSresPromptRequirement[] = [
  {
    ...COMMON_OWNER_PROMPT,
    fields: [...COMMON_OWNER_PROMPT.fields, "owner_email_required_for_product_recall_contact"],
    source: citation(
      "batteryBulkFieldsPage",
      "CER, Required fields for solar battery bulk upload, last updated 25 November 2025; owner email is mandatory.",
    ),
  },
  COMMON_AGENT_PROMPT,
  COMMON_TRADE_PROMPT,
  COMMON_SITE_PROMPT,
  {
    key: "battery_installation_details",
    label: "Solar battery installation and connection details",
    kind: "installation",
    required: true,
    valueSource: "operator",
    fields: [
      "installation_address",
      "certification_date",
      "connection_type",
      "existing_solar_pv_at_address",
      "property_type",
      "single_or_multi_story",
      "vpp_capable",
      "nmi",
      "retailer_involved",
      "installer_changed_default_manufacturer_settings",
    ],
    when: "always",
    source: citation(
      "batteryAssignmentExample",
      "CER battery STC assignment example, version 1.0, installation details, p. 3.",
    ),
  },
  {
    key: "battery_components",
    label: "Approved battery and inverter component identities",
    kind: "product",
    required: true,
    valueSource: "official_product_snapshot",
    fields: [
      "battery_brand",
      "battery_series",
      "battery_model",
      "battery_count",
      "battery_serial_numbers",
      "nominal_capacity_kwh",
      "usable_capacity_kwh",
      "new_inverter_added",
      "inverter_brand",
      "inverter_series",
      "inverter_model",
      "inverter_count",
      "inverter_serial_numbers",
    ],
    when: "always; inverter fields apply where an inverter is added or used",
    source: citation(
      "batteryAssignmentExample",
      "CER battery STC assignment example, version 1.0, system component details, p. 4.",
    ),
  },
  {
    key: "battery_professionals_and_retailer",
    label: "Installer, designer, electrician and retailer identities",
    kind: "identity",
    required: true,
    valueSource: "assigned_trade_technician",
    fields: [
      "installer_full_name_company_contact_address_accreditation_number_type_and_electrical_licence",
      "designer_full_name_company_contact_address_accreditation_number_and_type",
      "electrician_full_name_company_contact_address_and_licence_number",
      "retailer_legal_entity_name_abn_representative_and_position",
    ],
    when: "always",
    source: citation(
      "batteryAssignmentExample",
      "CER battery STC assignment example, version 1.0, designer, installer, electrician and retailer details, pp. 6-7.",
    ),
  },
  {
    key: "battery_calculation_inputs",
    label: "Battery entitlement inputs",
    kind: "calculation",
    required: true,
    valueSource: "derived_from_formula",
    fields: ["certification_date", "claim_scope_new_system", "nominal_capacity_kwh", "usable_capacity_kwh"],
    when: "always",
    source: citation(
      "calculateStcs",
      "CER entitlement page, last updated 30 April 2026, STC factors for solar batteries and Amount of support according to system size.",
    ),
  },
];

function windHydroPrompts(
  activityCode: "WIND" | "HYDRO",
): readonly CreditexSresPromptRequirement[] {
  const wind = activityCode === "WIND";
  return [
    COMMON_OWNER_PROMPT,
    COMMON_AGENT_PROMPT,
    COMMON_TRADE_PROMPT,
    COMMON_SITE_PROMPT,
    {
      key: `${activityCode.toLowerCase()}_system_details`,
      label: `${wind ? "Wind" : "Hydro"} system details`,
      kind: "installation",
      required: true,
      valueSource: "operator",
      fields: [
        "installation_date",
        "system_brand",
        "system_model",
        "inverter_manufacturer_series_and_model_if_used",
        "complete_unit",
        "installation_type",
        "rated_power_output_kw",
        "equipment_serial_numbers",
        "grid_connection_type",
        "previously_failed_accreditation_code_and_explanation_if_applicable",
      ],
      when: "always; inverter fields apply when an inverter is used",
      source: citation(
        "sguMandatoryInformation",
        wind
          ? "CER SGU mandatory information guide, February 2022, wind installation fields, pp. 8-10."
          : "CER SGU mandatory information guide, February 2022, hydro installation fields, pp. 11-13.",
      ),
    },
    {
      key: `${activityCode.toLowerCase()}_resource_availability`,
      label: `${wind ? "Wind" : "Hydro"} resource availability route`,
      kind: "calculation",
      required: true,
      valueSource: "operator",
      fields: [
        "use_government_default_resource_hours",
        "site_assessed_resource_hours_per_year",
        "site_specific_audit_report_available",
        "certificate_period",
      ],
      when: "site assessment fields are required when the default resource availability is not used",
      source: citation(
        "sguMandatoryInformation",
        wind
          ? "CER SGU mandatory information guide, February 2022, wind site audit, deeming and resource availability, pp. 9-10."
          : "CER SGU mandatory information guide, February 2022, hydro site audit, deeming and resource availability, pp. 11-12.",
      ),
    },
    {
      key: `${activityCode.toLowerCase()}_professionals`,
      label: "Installer, designer and electrician identities",
      kind: "identity",
      required: true,
      valueSource: "assigned_trade_technician",
      fields: [
        "installer_name_contact_address_accreditation_number_and_type",
        "designer_name_contact_address_accreditation_number_and_type",
        "electrician_name_contact_address_and_licence_number",
      ],
      when: "always",
      source: citation(
        "sguMandatoryInformation",
        "CER SGU mandatory information guide, February 2022, installer, electrician and designer details, pp. 17-21.",
      ),
    },
  ];
}

function waterHeaterPrompts(
  activityCode: "SWH" | "ASHP",
): readonly CreditexSresPromptRequirement[] {
  return [
    {
      ...COMMON_OWNER_PROMPT,
      fields: [
        "first_name",
        "last_name",
        "postal_address",
        "primary_contact_number",
        "alternative_contact_number",
        "email_address",
      ],
      source: citation(
        "swhMandatoryInformation",
        "CER SWH mandatory information guide, version 1.1, system owner details, p. 4.",
      ),
    },
    COMMON_AGENT_PROMPT,
    COMMON_TRADE_PROMPT,
    {
      ...COMMON_SITE_PROMPT,
      fields: [
        "address_lines",
        "suburb_or_city",
        "state_or_territory",
        "postcode",
        "property_type",
        "single_or_multi_story",
        "more_than_one_water_heater_at_address",
        "relative_installation_location",
        "additional_circumstances",
      ],
      source: citation(
        "swhMandatoryInformation",
        "CER SWH mandatory information guide, version 1.1, installation details, pp. 5-6.",
      ),
    },
    {
      key: `${activityCode.toLowerCase()}_system_details`,
      label: activityCode === "SWH" ? "Solar water heater system details" : "Air-source heat-pump water-heater system details",
      kind: "product",
      required: true,
      valueSource: "official_product_snapshot",
      fields: [
        "installation_date",
        "installation_category",
        "brand",
        "model",
        "serial_numbers",
        "tank_size_litres",
        "solar_panel_count_if_applicable",
        "capacity_greater_than_700_litres",
        "registered_ten_year_stcs_for_postcode_zone",
      ],
      when: "always; solar-panel and over-700-litre fields apply only where relevant",
      source: citation(
        "swhMandatoryInformation",
        "CER SWH mandatory information guide, version 1.1, installation category, system details and STC eligibility, pp. 6-7.",
      ),
    },
    {
      key: `${activityCode.toLowerCase()}_installer`,
      label: "Individual installer and installer business",
      kind: "identity",
      required: true,
      valueSource: "assigned_trade_technician",
      fields: [
        "installer_first_name",
        "installer_last_name",
        "installer_business_name",
        "installer_postal_address",
        "installer_primary_contact_number",
        "installer_alternative_contact_number",
        "installer_email",
      ],
      when: "always",
      source: citation(
        "swhMandatoryInformation",
        "CER SWH mandatory information guide, version 1.1, installer information, pp. 8-9.",
      ),
    },
    {
      key: `${activityCode.toLowerCase()}_calculation_inputs`,
      label: "Registered water-heater entitlement inputs",
      kind: "calculation",
      required: true,
      valueSource: "derived_from_formula",
      fields: ["installation_date", "registered_ten_year_stcs", "postcode_zone", "deeming_multiplier"],
      when: "always",
      source: citation(
        "calculateStcs",
        "CER entitlement page, last updated 30 April 2026, Multiplication factors for solar water heaters and air source heat pumps.",
      ),
    },
  ];
}

const PV_EVIDENCE: readonly CreditexSresEvidenceRequirement[] = [
  {
    requirementId: "pv_stc_assignment",
    kind: "signed_statement",
    label: "Signed STC assignment and system-owner declaration",
    details: [
      "assignment of the right to create STCs to the registered agent",
      "system-owner mandatory declaration",
      "owner and witness signing record",
    ],
    when: "Creditex is the registered agent",
    required: true,
    preserveOriginalMetadata: false,
    source: PV_FORM,
  },
  {
    requirementId: "pv_designer_statement",
    kind: "signed_statement",
    label: "Solar PV designer written statement",
    details: ["designer identity and accreditation", "compulsory designer statements"],
    when: "always",
    required: true,
    preserveOriginalMetadata: false,
    source: PV_FORM,
  },
  {
    requirementId: "pv_installer_statement",
    kind: "signed_statement",
    label: "Solar PV installer written statement",
    details: ["installer identity and accreditation", "compulsory installer statements"],
    when: "always",
    required: true,
    preserveOriginalMetadata: false,
    source: PV_FORM,
  },
  {
    requirementId: "pv_retailer_statement",
    kind: "signed_statement",
    label: "Solar retailer written statement",
    details: ["retailer legal entity and ABN", "retailer representative and compulsory statements"],
    when: "a solar retailer was involved",
    required: true,
    preserveOriginalMetadata: false,
    source: PV_FORM,
  },
  {
    requirementId: "pv_electrical_safety_certificate",
    kind: "certificate",
    label: "Electrical safety certificate or Western Australian electrical notice",
    details: ["state or territory electrical safety evidence"],
    when: "always",
    required: true,
    preserveOriginalMetadata: false,
    source: CREATE_COMMON,
  },
  {
    requirementId: "pv_module_serial_photos",
    kind: "geotagged_photograph",
    label: "PV module serial-number photographs",
    details: ["serial number visible on the installed product", "time and date metadata", "geolocation metadata"],
    when: "always",
    required: true,
    preserveOriginalMetadata: true,
    source: CREATE_COMMON,
  },
  {
    requirementId: "pv_inverter_serial_photos",
    kind: "geotagged_photograph",
    label: "Inverter serial-number photographs",
    details: ["serial number visible on the installed product", "time and date metadata", "geolocation metadata"],
    when: "always",
    required: true,
    preserveOriginalMetadata: true,
    source: CREATE_COMMON,
  },
  {
    requirementId: "pv_installer_onsite_photos",
    kind: "geotagged_photograph",
    label: "Installer onsite photographs",
    details: ["installer face visible onsite", "time and date metadata", "geolocation metadata"],
    when: "always",
    required: true,
    preserveOriginalMetadata: true,
    source: CREATE_COMMON,
  },
  {
    requirementId: "pv_invoice",
    kind: "invoice",
    label: "System invoice",
    details: ["system and installation transaction record"],
    when: "retain when available; CER lists this as optional evidence",
    required: false,
    preserveOriginalMetadata: false,
    source: CREATE_COMMON,
  },
];

const BATTERY_EVIDENCE: readonly CreditexSresEvidenceRequirement[] = [
  {
    requirementId: "battery_stc_assignment",
    kind: "signed_statement",
    label: "Signed battery STC assignment and system-owner declaration",
    details: ["assignment to the registered agent", "owner declaration", "owner and witness signing record"],
    when: "Creditex is the registered agent",
    required: true,
    preserveOriginalMetadata: false,
    source: BATTERY_FORM,
  },
  ...["designer", "installer", "retailer"].map((role) => ({
    requirementId: `battery_${role}_statement`,
    kind: "signed_statement" as const,
    label: `Battery ${role} written statement`,
    details: [`${role} identity`, `compulsory ${role} statements`],
    when: "always",
    required: true,
    preserveOriginalMetadata: false,
    source: BATTERY_FORM,
  })),
  {
    requirementId: "battery_electrical_safety_certificate",
    kind: "certificate",
    label: "Electrical safety certificate or Western Australian electrical notice",
    details: ["state or territory electrical safety evidence"],
    when: "always",
    required: true,
    preserveOriginalMetadata: false,
    source: CREATE_COMMON,
  },
  {
    requirementId: "battery_stage_selfies",
    kind: "geotagged_photograph",
    label: "Installer onsite photographs at required installation stages",
    details: [
      "job setup before work begins",
      "mid-installation",
      "commissioning",
      "completed installation",
      "installer face, time, date and geolocation retained",
    ],
    when: "always",
    required: true,
    preserveOriginalMetadata: true,
    source: BATTERY_PHOTOS,
  },
  {
    requirementId: "battery_component_serial_photos",
    kind: "geotagged_photograph",
    label: "Battery and inverter serial-number photographs",
    details: ["serial number visible on each product", "time, date and geolocation retained"],
    when: "always; inverter photograph applies when an inverter is installed or used",
    required: true,
    preserveOriginalMetadata: true,
    source: BATTERY_PHOTOS,
  },
  {
    requirementId: "battery_critical_labelling_photos",
    kind: "geotagged_photograph",
    label: "Battery critical-labelling photographs",
    details: [
      "meter box",
      "main switchboard",
      "front and sides of battery system",
      "time, date and geolocation retained",
    ],
    when: "systems installed from 1 March 2026",
    required: true,
    preserveOriginalMetadata: true,
    source: BATTERY_PHOTOS,
  },
  {
    requirementId: "battery_invoice",
    kind: "invoice",
    label: "Battery invoice",
    details: ["battery and installation transaction record"],
    when: "retain when available; CER lists this as optional evidence",
    required: false,
    preserveOriginalMetadata: false,
    source: CREATE_COMMON,
  },
];

function windHydroEvidence(
  activityCode: "WIND" | "HYDRO",
): readonly CreditexSresEvidenceRequirement[] {
  const label = activityCode === "WIND" ? "wind" : "hydro";
  return [
    {
      requirementId: `${label}_stc_assignment`,
      kind: "signed_statement",
      label: `Signed ${label} STC assignment`,
      details: ["assignment of the right to create STCs to the registered agent"],
      when: "Creditex is the registered agent",
      required: true,
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
    {
      requirementId: `${label}_installer_statement`,
      kind: "signed_statement",
      label: `${activityCode === "WIND" ? "Wind" : "Hydro"} installer written statement`,
      details: ["installer identity", "installer mandatory statements"],
      when: "always",
      required: true,
      preserveOriginalMetadata: false,
      source: SGU_COMMON,
    },
    {
      requirementId: `${label}_electrical_safety_certificate`,
      kind: "certificate",
      label: "Electrical safety certificate or Western Australian electrical notice",
      details: ["state or territory electrical safety evidence"],
      when: "always",
      required: true,
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
    {
      requirementId: `${label}_site_audit_report`,
      kind: "technical_report",
      label: `${activityCode === "WIND" ? "Wind" : "Hydro"} site-specific resource audit report`,
      details: ["site-assessed resource hours per year", "audit evidence supporting the non-default resource route"],
      when: "the government default resource availability is not used",
      required: true,
      preserveOriginalMetadata: false,
      source: citation(
        "sguMandatoryInformation",
        activityCode === "WIND"
          ? "CER SGU mandatory information guide, February 2022, wind site audit and resource availability, pp. 9-10."
          : "CER SGU mandatory information guide, February 2022, hydro site audit and resource availability, pp. 11-12.",
      ),
    },
    {
      requirementId: `${label}_invoice`,
      kind: "invoice",
      label: "System invoice",
      details: ["system and installation transaction record"],
      when: "retain when available; CER lists this as optional evidence",
      required: false,
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
  ];
}

function waterHeaterEvidence(
  activityCode: "SWH" | "ASHP",
): readonly CreditexSresEvidenceRequirement[] {
  const label = activityCode === "SWH" ? "swh" : "ashp";
  return [
    {
      requirementId: `${label}_stc_assignment`,
      kind: "signed_statement",
      label: "Signed water-heater STC assignment",
      details: ["assignment of the right to create STCs to the registered agent"],
      when: "Creditex is the registered agent",
      required: true,
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
    {
      requirementId: `${label}_installer_compliance_certificate`,
      kind: "certificate",
      label: "Installer compliance certificate",
      details: ["installer identity", "installation compliance record"],
      when: "always",
      required: true,
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
    {
      requirementId: `${label}_invoice`,
      kind: "invoice",
      label: "Water-heater invoice",
      details: ["evidence of installation date and installed unit"],
      when: "one invoice or date-stamped unit photograph is required",
      required: false,
      alternativeGroup: {
        groupId: `${label}_invoice_or_dated_unit_photo`,
        minimumRequired: 1,
      },
      preserveOriginalMetadata: false,
      source: CREATE_COMMON,
    },
    {
      requirementId: `${label}_dated_unit_photo`,
      kind: "geotagged_photograph",
      label: "Date-stamped installed-unit photograph",
      details: ["installed unit visible", "time and date metadata", "geolocation metadata"],
      when: "one invoice or date-stamped unit photograph is required",
      required: false,
      alternativeGroup: {
        groupId: `${label}_invoice_or_dated_unit_photo`,
        minimumRequired: 1,
      },
      preserveOriginalMetadata: true,
      source: CREATE_COMMON,
    },
    ...(activityCode === "SWH"
      ? [
          {
            requirementId: "swh_over_700l_owner_declaration",
            kind: "statutory_declaration" as const,
            label: "Owner statutory declaration for an over-700-litre system",
            details: ["owner, system, address and installation declaration"],
            when: "system capacity is at least 700 litres",
            required: true,
            preserveOriginalMetadata: false,
            source: citation(
              "swhOwnerStatutoryDeclaration",
              "CER Statutory declaration 1, owner declaration fields and signing block, p. 1.",
            ),
          },
          {
            requirementId: "swh_over_700l_size_declaration",
            kind: "statutory_declaration" as const,
            label: "System-size statutory declaration for an over-700-litre system",
            details: ["system configuration and size declaration"],
            when: "system capacity is at least 700 litres",
            required: true,
            preserveOriginalMetadata: false,
            source: citation(
              "swhSizeStatutoryDeclaration",
              "CER Statutory declaration 2, system-size declaration fields and signing block, p. 1.",
            ),
          },
        ]
      : []),
  ];
}

function productDependenciesForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresProductDependency[] {
  if (activityCode === "PV") {
    return [
      {
        productKind: "cec_approved_pv_module_csv",
        applicability: "required",
        registrySnapshotRequired: true,
        eligibilityDateKey: "installation_date",
        requiredSnapshotFields: ["manufacturer", "model", "approval_status", "valid_from", "valid_to"],
        source: citation(
          "pvModulesCsv",
          "CER approved PV modules CSV custody snapshot acquired 15 August 2026; exact bytes and SHA-256 are pinned in this candidate.",
        ),
      },
      {
        productKind: "cec_approved_inverter_csv",
        applicability: "required",
        registrySnapshotRequired: true,
        eligibilityDateKey: "installation_date",
        requiredSnapshotFields: ["manufacturer", "series", "model", "approval_status", "valid_from", "valid_to"],
        source: citation(
          "invertersCsv",
          "CER approved inverters CSV custody snapshot acquired 15 August 2026; exact bytes and SHA-256 are pinned in this candidate.",
        ),
      },
    ];
  }
  if (activityCode === "BESS") {
    return [
      {
        productKind: "cec_approved_solar_battery_csv",
        applicability: "required",
        registrySnapshotRequired: true,
        eligibilityDateKey: "certification_date",
        requiredSnapshotFields: [
          "manufacturer",
          "model",
          "nominal_capacity_kwh",
          "usable_capacity_kwh",
          "approval_status",
          "valid_from",
          "valid_to",
        ],
        source: citation(
          "batteriesCsv",
          "CER approved solar batteries CSV custody snapshot acquired 15 August 2026; exact bytes and SHA-256 are pinned in this candidate.",
        ),
      },
      {
        productKind: "cec_approved_inverter_csv",
        applicability: "required_if_inverter_used",
        registrySnapshotRequired: true,
        eligibilityDateKey: "certification_date",
        requiredSnapshotFields: ["manufacturer", "series", "model", "approval_status", "valid_from", "valid_to"],
        source: citation(
          "invertersCsv",
          "CER approved inverters CSV custody snapshot acquired 15 August 2026; exact bytes and SHA-256 are pinned in this candidate.",
        ),
      },
    ];
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return [
      {
        productKind: "wind_or_hydro_equipment_identity",
        applicability: "required",
        registrySnapshotRequired: false,
        eligibilityDateKey: null,
        requiredSnapshotFields: ["brand", "model", "rated_power_output_kw", "serial_numbers"],
        source: citation(
          "sguMandatoryInformation",
          activityCode === "WIND"
            ? "CER SGU mandatory information guide, February 2022, wind system fields, pp. 8-10."
            : "CER SGU mandatory information guide, February 2022, hydro system fields, pp. 11-13.",
        ),
      },
      {
        productKind: "cec_approved_inverter_csv",
        applicability: "required_if_inverter_used",
        registrySnapshotRequired: true,
        eligibilityDateKey: "installation_date",
        requiredSnapshotFields: ["manufacturer", "series", "model", "approval_status", "valid_from", "valid_to"],
        source: citation(
          "invertersCsv",
          "CER approved inverters CSV custody snapshot acquired 15 August 2026; exact bytes and SHA-256 are pinned in this candidate.",
        ),
      },
    ];
  }
  if (activityCode === "SWH") {
    return [
      {
        productKind: "cer_swh_under_700l_register_csv",
        applicability: "conditional_by_capacity",
        registrySnapshotRequired: true,
        eligibilityDateKey: "installation_date",
        requiredSnapshotFields: [
          "brand",
          "model",
          "eligible_from",
          "eligible_to",
          "zone_1_stcs",
          "zone_2_stcs",
          "zone_3_stcs",
          "zone_4_stcs",
        ],
        source: citation(
          "swhUnder700ModelsCsv",
          "CER Register of solar water heaters Version 58, solar water heater models with capacity less than 700 litres, CSV released 10 August 2026.",
        ),
      },
      {
        productKind: "cer_swh_over_700l_register_csv",
        applicability: "conditional_by_capacity",
        registrySnapshotRequired: true,
        eligibilityDateKey: "installation_date",
        requiredSnapshotFields: [
          "brand",
          "model",
          "eligible_from",
          "eligible_to",
          "zone_1_stcs",
          "zone_2_stcs",
          "zone_3_stcs",
          "zone_4_stcs",
        ],
        source: citation(
          "swhOver700ModelsCsv",
          "CER Register of solar water heaters Version 58, solar water heater models with capacity at least 700 litres, CSV released 10 August 2026.",
        ),
      },
    ];
  }
  return [
    {
      productKind: "cer_ashp_register_csv",
      applicability: "required",
      registrySnapshotRequired: true,
      eligibilityDateKey: "installation_date",
      requiredSnapshotFields: [
        "brand",
        "model",
        "eligible_from",
        "eligible_to",
        "zone_1_stcs",
        "zone_2_stcs",
        "zone_3_stcs",
        "zone_4_stcs",
        "zone_5_stcs",
      ],
      source: citation(
        "ashpModelsCsv",
        "CER Register of solar water heaters Version 58, air-source heat-pump models, CSV released 10 August 2026.",
      ),
    },
  ];
}

function postcodeZoneRuleForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["postcodeZoneRule"] {
  if (activityCode === "PV") {
    return {
      postcodeRequired: true,
      zoneApplicability: "solar_pv_zone_rating_required",
      zoneCount: 4,
      ratingValues: ["1.622", "1.536", "1.382", "1.185"],
      source: citation(
        "pvPostcodeZones",
        "CER Postcode zone ratings and zones for solar panel systems, effective 1 January 2020, zone ratings table and postcode ranges.",
      ),
    };
  }
  if (activityCode === "SWH" || activityCode === "ASHP") {
    return {
      postcodeRequired: true,
      zoneApplicability: "water_heater_zone_required",
      zoneCount: activityCode === "SWH" ? 4 : 5,
      ratingValues: activityCode === "SWH"
        ? ["zone_1", "zone_2", "zone_3", "zone_4"]
        : ["zone_1", "zone_2", "zone_3", "zone_4", "zone_5"],
      source: citation(
        "waterHeaterPostcodeZones",
        "CER Postcode zones for solar water heaters and air-source heat pumps, version 3 effective 1 January 2020, postcode ranges.",
      ),
    };
  }
  return {
    postcodeRequired: true,
    zoneApplicability: "not_used_in_certificate_arithmetic",
    zoneCount: 0,
    ratingValues: [],
    source: activityCode === "BESS"
      ? citation(
          "batteryAssignmentExample",
          "CER battery STC assignment example, version 1.0, physical installation address, p. 3.",
        )
      : citation(
          "sguMandatoryInformation",
          "CER SGU mandatory information guide, February 2022, physical installation address, pp. 15-16.",
        ),
  };
}

function deemingRuleForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["deemingRule"] {
  if (activityCode === "PV") {
    return {
      applicability: "one_five_or_maximum_period",
      installationYears: [2026, 2027, 2028, 2029, 2030],
      sourceOptions: ["one_year", "five_years", "maximum_deeming_period"],
      source: CALCULATE_COMMON,
    };
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return {
      applicability: "one_or_current_maximum_period",
      installationYears: [2026, 2027, 2028, 2029, 2030],
      sourceOptions: ["one_year", "maximum_deeming_period"],
      source: citation(
        "regulations",
        "Renewable Energy (Electricity) Regulations 2001, Compilation No. 90, reg 20, certificate period and resource availability, PDF pp. 45-49.",
      ),
    };
  }
  if (activityCode === "SWH" || activityCode === "ASHP") {
    return {
      applicability: "registered_ten_year_entitlement_multiplier",
      installationYears: [2026, 2027, 2028, 2029, 2030],
      sourceOptions: [
        "2026:0.5",
        "2027:0.4",
        "2028:0.3",
        "2029:0.2",
        "2030:0.1",
      ],
      source: CALCULATE_COMMON,
    };
  }
  return {
    applicability: "not_applicable_battery_date_factor",
    installationYears: [2026, 2027, 2028, 2029, 2030],
    sourceOptions: [
      "2026-01-01_to_2026-04-30:8.4",
      "2026-05-01_to_2026-12-31:6.8",
      "2027-01-01_to_2027-06-30:5.7",
      "2027-07-01_to_2027-12-31:5.2",
      "2028-01-01_to_2028-06-30:4.6",
      "2028-07-01_to_2028-12-31:4.1",
      "2029-01-01_to_2029-06-30:3.6",
      "2029-07-01_to_2029-12-31:3.1",
      "2030-01-01_to_2030-06-30:2.6",
      "2030-07-01_to_2030-12-31:2.1",
    ],
    source: CALCULATE_COMMON,
  };
}

function scenarioRulesForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["scenarioRules"] {
  const options: Record<CreditexCurrentSresActivityCode, readonly string[]> = {
    PV: ["complete_unit", "new_system", "rated_capacity_at_most_100_kw", "annual_output_below_250_mwh"],
    BESS: [
      "new_eligible_system",
      "replacement_or_expansion_only_where_pre_2025-07-01_battery_was_installed",
      "one_stc_claim_per_address",
      "nominal_capacity_5_to_100_kwh_inclusive",
    ],
    WIND: ["complete_unit", "rated_capacity_at_most_10_kw", "annual_output_below_25_mwh"],
    HYDRO: ["complete_unit", "rated_capacity_at_most_6.4_kw", "annual_output_below_25_mwh"],
    SWH: ["capacity_below_700_litres", "capacity_at_least_700_litres_with_additional_documents"],
    ASHP: ["capacity_at_most_425_litres"],
  };
  return {
    officialScenarioCode: null,
    classification: "no_separate_scenario_code_use_source_options",
    sourceOptions: options[activityCode],
    source: activityCode === "BESS"
      ? CREATE_COMMON
      : activityCode === "PV" || activityCode === "WIND" || activityCode === "HYDRO"
        ? SYSTEMS_CURRENT
        : activityCode === "SWH"
          ? SYSTEMS_CURRENT
          : SYSTEMS_CURRENT,
  };
}

const CALCULATOR_INPUT_KEYS: Readonly<
  Record<CreditexCurrentSresActivityCode, readonly string[]>
> = {
  PV: ["installationDate", "ratedCapacityKw", "zoneRating"],
  BESS: ["certificationDate", "claimScope", "nominalCapacityKwh", "usableCapacityKwh"],
  WIND: [
    "installationDate",
    "ratedCapacityKw",
    "resourceAvailability",
    "resourceHoursPerYear",
    "deemingYears",
  ],
  HYDRO: [
    "installationDate",
    "ratedCapacityKw",
    "resourceAvailability",
    "resourceHoursPerYear",
    "deemingYears",
  ],
  SWH: ["installationDate", "registeredTenYearStcs"],
  ASHP: ["installationDate", "registeredTenYearStcs"],
};

const CALCULATOR_FORMULA_SUMMARIES: Readonly<
  Record<CreditexCurrentSresActivityCode, string>
> = {
  PV: "floor(ratedCapacityKw multiplied by the official postcode zone rating multiplied by 2031 minus the installation year)",
  BESS: "floor(the claimable usable capacity, capped at 50 kWh and date-weighted by the published capacity bands where applicable, multiplied by the certification-date factor)",
  WIND: "floor(the regulation 0.00095 factor multiplied by ratedCapacityKw, controlled wind resource hours and the selected certificate period, after the statutory 0.5-to-below-1 minimum)",
  HYDRO: "floor(the regulation 0.00095 factor multiplied by ratedCapacityKw, controlled hydro resource hours and the selected certificate period, after the statutory 0.5-to-below-1 minimum)",
  SWH: "floor(the installation-date eligible registered ten-year STC value multiplied by the published installation-year multiplier)",
  ASHP: "floor(the installation-date eligible registered ten-year STC value multiplied by the published installation-year multiplier)",
};

function signaturesForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresSignatureRequirement[] {
  if (activityCode === "PV" || activityCode === "BESS") {
    const source = activityCode === "PV" ? PV_FORM : BATTERY_FORM;
    const documentType = activityCode === "PV"
      ? "solar_pv_stc_assignment_and_statements"
      : "solar_battery_stc_assignment_and_statements";
    return [
      ["owner", "system_owner"],
      ["owner_witness", "owner_witness"],
      ["designer", "designer"],
      ["designer_witness", "designer_witness"],
      ["installer", "installer"],
      ["installer_witness", "installer_witness"],
      ["retailer", "retailer_representative"],
      ["retailer_witness", "retailer_witness"],
    ].map(([suffix, signerRole]) => ({
      signatureId: `${activityCode.toLowerCase()}_${suffix}_signature`,
      documentType,
      signerRole: signerRole as CreditexSresSignatureRequirement["signerRole"],
      required: true,
      when: suffix.startsWith("retailer")
        ? "a retailer was involved"
        : "always",
      visibleSignatureBox: true,
      autofillIntoFinalPdf: true,
      source,
    }));
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    const prefix = activityCode.toLowerCase();
    return [
      {
        signatureId: `${prefix}_owner_assignment_signature`,
        documentType: `${prefix}_stc_assignment`,
        signerRole: "system_owner",
        required: true,
        when: "Creditex is the registered agent",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: CREATE_COMMON,
      },
      {
        signatureId: `${prefix}_installer_statement_signature`,
        documentType: `${prefix}_installer_statement`,
        signerRole: "installer",
        required: true,
        when: "always",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: SGU_COMMON,
      },
      {
        signatureId: `${prefix}_designer_statement_signature`,
        documentType: `${prefix}_designer_statement`,
        signerRole: "designer",
        required: true,
        when: "always",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: SGU_COMMON,
      },
    ];
  }
  const prefix = activityCode.toLowerCase();
  const signatures: CreditexSresSignatureRequirement[] = [
    {
      signatureId: `${prefix}_owner_assignment_signature`,
      documentType: `${prefix}_stc_assignment`,
      signerRole: "system_owner",
      required: true,
      when: "Creditex is the registered agent",
      visibleSignatureBox: true,
      autofillIntoFinalPdf: true,
      source: CREATE_COMMON,
    },
    {
      signatureId: `${prefix}_installer_compliance_signature`,
      documentType: `${prefix}_installer_compliance_certificate`,
      signerRole: "installer_compliance_signatory",
      required: true,
      when: "always",
      visibleSignatureBox: true,
      autofillIntoFinalPdf: true,
      source: SWH_FIELDS,
    },
  ];
  if (activityCode === "SWH") {
    signatures.push(
      {
        signatureId: "swh_over_700l_owner_statutory_signature",
        documentType: "swh_over_700l_owner_statutory_declaration",
        signerRole: "statutory_declarant",
        required: true,
        when: "system capacity is at least 700 litres",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: citation(
          "swhOwnerStatutoryDeclaration",
          "CER Statutory declaration 1, declarant and authorised-witness signing blocks, p. 1.",
        ),
      },
      {
        signatureId: "swh_over_700l_owner_statutory_witness_signature",
        documentType: "swh_over_700l_owner_statutory_declaration",
        signerRole: "authorised_statutory_witness",
        required: true,
        when: "system capacity is at least 700 litres",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: citation(
          "swhOwnerStatutoryDeclaration",
          "CER Statutory declaration 1, declarant and authorised-witness signing blocks, p. 1.",
        ),
      },
      {
        signatureId: "swh_over_700l_size_statutory_signature",
        documentType: "swh_over_700l_size_statutory_declaration",
        signerRole: "statutory_declarant",
        required: true,
        when: "system capacity is at least 700 litres",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: citation(
          "swhSizeStatutoryDeclaration",
          "CER Statutory declaration 2, declarant and authorised-witness signing blocks, p. 1.",
        ),
      },
      {
        signatureId: "swh_over_700l_size_statutory_witness_signature",
        documentType: "swh_over_700l_size_statutory_declaration",
        signerRole: "authorised_statutory_witness",
        required: true,
        when: "system capacity is at least 700 litres",
        visibleSignatureBox: true,
        autofillIntoFinalPdf: true,
        source: citation(
          "swhSizeStatutoryDeclaration",
          "CER Statutory declaration 2, declarant and authorised-witness signing blocks, p. 1.",
        ),
      },
    );
  }
  return signatures;
}

function referenceDocumentsForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresSourceBinding[] {
  const common = [ACT_ASSIGNMENT, CREATE_COMMON, CALCULATE_COMMON, COMPLIANCE_CURRENT];
  if (activityCode === "PV") {
    return [
      ...common,
      REGULATIONS_SGU,
      SGU_COMMON,
      PV_FORM,
      postcodeZoneRuleForActivity(activityCode).source,
      ...productDependenciesForActivity(activityCode).map((dependency) => dependency.source),
    ];
  }
  if (activityCode === "BESS") {
    return [
      ...common,
      REGULATIONS_SGU,
      BATTERY_FORM,
      BATTERY_PHOTOS,
      citation(
        "batteryInspectionChecklist",
        "CER Solar battery inspection checklist, custody candidate acquired 15 August 2026.",
      ),
      citation(
        "batteryInstallersDesigners",
        "CER Solar battery installers and designers, last updated 31 July 2026, installer obligations and installation attendance.",
      ),
      citation(
        "batteryBulkFieldsPage",
        "CER Required fields for solar battery bulk upload, current public landing page acquired 15 August 2026.",
      ),
      ...productDependenciesForActivity(activityCode).map((dependency) => dependency.source),
    ];
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return [
      ...common,
      REGULATIONS_SGU,
      SGU_COMMON,
      citation(
        "registryBulkUploadGuide",
        "CER REC Registry bulk-upload guide for small-generation-unit and solar-water-heater installations, custody candidate acquired 15 August 2026.",
      ),
      ...productDependenciesForActivity(activityCode).map((dependency) => dependency.source),
    ];
  }
  const waterHeaterDocuments = [
    ...common,
    REGULATIONS_SWH,
    SWH_FIELDS,
    citation(
      "swhRegisterPage",
      "CER Register of solar water heaters, current public register page acquired 15 August 2026.",
    ),
    citation(
      "swhRegisterRelease",
      "CER Register of solar water heaters Version 58 release notice, published 10 August 2026.",
    ),
    citation(
      "swhMethod",
      "Renewable Energy (Electricity) Method for Solar Water Heaters Determination 2016, Compilation No. 2, effective 1 January 2022.",
    ),
    postcodeZoneRuleForActivity(activityCode).source,
    ...productDependenciesForActivity(activityCode).map((dependency) => dependency.source),
  ];
  if (activityCode === "SWH") {
    waterHeaterDocuments.push(
      citation(
        "swhOwnerStatutoryDeclaration",
        "CER Statutory declaration 1, owner declaration for relevant solar-water-heater systems, p. 1.",
      ),
      citation(
        "swhSizeStatutoryDeclaration",
        "CER Statutory declaration 2, system-size declaration for relevant solar-water-heater systems, p. 1.",
      ),
    );
  }
  return waterHeaterDocuments;
}

function finalDocumentNeedsForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresFinalDocumentNeed[] {
  const prefix = activityCode.toLowerCase();
  return [
    {
      documentType: `${prefix}_stc_assignment_pdf`,
      label: "Signed STC assignment and declarations PDF",
      required: true,
      when: "Creditex is the registered agent",
      format: "pdf",
      immutableAfterFinalisation: true,
      source: activityCode === "PV"
        ? PV_FORM
        : activityCode === "BESS"
          ? BATTERY_FORM
          : CREATE_COMMON,
    },
    {
      documentType: `${prefix}_compliance_work_pack_pdf`,
      label: "Completed activity work-pack PDF",
      required: true,
      when: "before compliance review",
      format: "pdf",
      immutableAfterFinalisation: true,
      source: CREATE_COMMON,
    },
    {
      documentType: `${prefix}_calculation_receipt_pdf`,
      label: "Deterministic calculation input and trace receipt PDF",
      required: true,
      when: "a runtime calculation is executed",
      format: "pdf",
      immutableAfterFinalisation: true,
      source: CALCULATE_COMMON,
    },
    {
      documentType: `${prefix}_original_evidence_bundle`,
      label: "Original evidence files with unmodified media metadata",
      required: true,
      when: "before compliance review",
      format: "original_evidence",
      immutableAfterFinalisation: true,
      source: CREATE_COMMON,
    },
    {
      documentType: `${prefix}_rec_registry_creation_record`,
      label: "REC Registry creation and registration record",
      required: true,
      when: "after an authorised registered-agent submission",
      format: "external_record",
      immutableAfterFinalisation: true,
      source: ACT_ASSIGNMENT,
    },
  ];
}

function gapsForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["gaps"] {
  const common: CreditexSresWorkPackContentCandidate["gaps"] = [
    {
      code: "SRES_INDEPENDENT_CREDITEX_REVIEW_REQUIRED",
      blocksActivation: true,
      detail: "The pinned official-source content and activity mapping have not received independent Creditex compliance approval.",
    },
    {
      code: "SRES_REC_REGISTRY_CURRENT_SUBMISSION_SCHEMA_MISSING",
      blocksActivation: true,
      detail: "The current authenticated REC Registry creation schema, validation responses and acceptance receipt contract are not present in tracked custody.",
    },
    {
      code: "SRES_CURRENT_DECLARATION_SNAPSHOT_CONNECTOR_MISSING",
      blocksActivation: true,
      detail: "The current declaration text published by CER is not connected as an immutable, effective-dated runtime snapshot.",
    },
    {
      code: "SRES_CURRENT_PRODUCT_RECALL_CONNECTOR_MISSING",
      blocksActivation: true,
      detail: "A monitored effective-dated connector for product suspensions, recalls and removals is not present.",
    },
    {
      code: "SRES_OFFICIAL_CALCULATOR_GOLDEN_VECTORS_MISSING",
      blocksActivation: true,
      detail: "Independent CER or REC Registry golden vectors have not been captured to approve the local arithmetic for certificate action.",
    },
    {
      code: "SRES_REGISTERED_AGENT_ACCOUNT_AND_ASSIGNMENT_NOT_VERIFIED",
      blocksActivation: true,
      detail: "Creditex's registered-agent account, assignment wording and authorised submission identity have not been verified in this candidate.",
    },
  ];
  if (activityCode === "PV") {
    return [
      ...common,
      {
        code: "SRES_APPROVED_COMPONENT_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "The pinned PV module and inverter CSVs are custody candidates; a monitored installation-date eligibility connector is not active.",
      },
      {
        code: "SRES_ACCREDITATION_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "Current installer and designer accreditation status is not available through a monitored effective-dated connector.",
      },
    ];
  }
  if (activityCode === "BESS") {
    return [
      ...common,
      {
        code: "SRES_APPROVED_COMPONENT_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "The pinned battery and inverter CSVs are custody candidates; a monitored certification-date eligibility connector is not active.",
      },
      {
        code: "SRES_ACCREDITATION_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "Current installer and designer Solar Accreditation Australia status is not available through a monitored connector.",
      },
      {
        code: "SRES_BATTERY_BULK_UPLOAD_WORKBOOK_MISSING",
        blocksActivation: true,
        detail: "The public landing page is pinned, but the current battery bulk-upload workbook bytes and exact field contract are absent from custody.",
      },
      {
        code: "SRES_BATTERY_ONE_CLAIM_PER_ADDRESS_CHECK_MISSING",
        blocksActivation: true,
        detail: "No authoritative address-level check enforces CER's one battery STC claim per address rule.",
      },
      {
        code: "SRES_BATTERY_PRE_2025_REPLACEMENT_EXPANSION_CONTRACT_MISSING",
        blocksActivation: true,
        detail: "The local estimator supports a new system only; the source-backed pre-1-July-2025 replacement or expansion exception has no executable evidence contract.",
      },
      {
        code: "SRES_BATTERY_INSTALLER_DAILY_LIMIT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "No authoritative cross-job control enforces the current two-battery-installations-per-installer-per-day limit.",
      },
    ];
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return [
      ...common,
      {
        code: "SRES_APPROVED_COMPONENT_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "Where an inverter is used, a monitored installation-date approved-inverter connector is not active.",
      },
      {
        code: "SRES_ACCREDITATION_SNAPSHOT_CONNECTOR_MISSING",
        blocksActivation: true,
        detail: "Current installer and designer accreditation status is not available through a monitored effective-dated connector.",
      },
      {
        code: "SRES_WIND_HYDRO_ASSIGNMENT_FORM_TEMPLATE_MISSING",
        blocksActivation: true,
        detail: "No exact current CER assignment-form template for this wind or hydro activity is present in tracked custody.",
      },
      {
        code: "SRES_WIND_HYDRO_SITE_AUDIT_TEMPLATE_MISSING",
        blocksActivation: true,
        detail: "No exact current site-specific resource-audit template and approval contract is present in tracked custody.",
      },
    ];
  }
  return [
    ...common,
    {
      code: "SRES_WATER_HEATER_ASSIGNMENT_FORM_TEMPLATE_MISSING",
      blocksActivation: true,
      detail: "No exact current CER STC assignment-form template for solar water heaters or air-source heat pumps is present in tracked custody.",
    },
  ];
}

function promptsForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresPromptRequirement[] {
  if (activityCode === "PV") return PV_PROMPTS;
  if (activityCode === "BESS") return BATTERY_PROMPTS;
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return windHydroPrompts(activityCode);
  }
  return waterHeaterPrompts(activityCode);
}

function evidenceForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): readonly CreditexSresEvidenceRequirement[] {
  if (activityCode === "PV") return PV_EVIDENCE;
  if (activityCode === "BESS") return BATTERY_EVIDENCE;
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return windHydroEvidence(activityCode);
  }
  return waterHeaterEvidence(activityCode);
}

function identityBindingsForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["identityBindings"] {
  const common = {
    registeredAgent: "creditex_provider_for_job" as const,
    systemOwner: "job_system_owner_or_authorised_signatory" as const,
    installerBusiness: "assigned_trade_business_for_job" as const,
    assignedTechnician: "assigned_trade_technician_for_appointment" as const,
    installerIndividual: "captured_individual_installer_for_system" as const,
  };
  if (activityCode === "PV" || activityCode === "BESS") {
    return {
      ...common,
      designerIndividual: "captured_individual_designer_for_system",
      electricianIndividual: "captured_individual_electrician_for_system",
      retailerLegalEntity: "captured_selling_legal_entity_for_system",
    };
  }
  if (activityCode === "WIND" || activityCode === "HYDRO") {
    return {
      ...common,
      designerIndividual: "captured_individual_designer_for_system",
      electricianIndividual: "captured_individual_electrician_for_system",
      retailerLegalEntity: "not_required_by_activity_source",
    };
  }
  return {
    ...common,
    designerIndividual: "not_required_by_activity_source",
    electricianIndividual: "not_required_by_activity_source",
    retailerLegalEntity: "not_required_by_activity_source",
  };
}

function statusDecisionForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["statusDecision"] {
  const limitations: Record<CreditexCurrentSresActivityCode, readonly string[]> = {
    PV: ["rated capacity at most 100 kW", "annual electricity output below 250 MWh"],
    BESS: [
      "eligible from 1 July 2025",
      "nominal capacity from 5 kWh to 100 kWh inclusive",
      "one battery STC claim per address, subject to the published pre-1-July-2025 replacement or expansion exception",
    ],
    WIND: ["rated capacity at most 10 kW", "annual electricity output below 25 MWh"],
    HYDRO: ["rated capacity at most 6.4 kW", "annual electricity output below 25 MWh"],
    SWH: ["registered system", "additional documents apply to systems at least 700 litres"],
    ASHP: ["registered system", "capacity at most 425 litres"],
  };
  return {
    state: "current",
    activityEffectiveFrom: activityCode === "BESS" ? "2025-07-01" : null,
    effectiveTo: null,
    sourceBackedLimitations: limitations[activityCode],
    source: SYSTEMS_CURRENT,
  };
}

function calculatorForActivity(
  activityCode: CreditexCurrentSresActivityCode,
): CreditexSresWorkPackContentCandidate["calculator"] {
  const method = governmentActivityCalculationMethods("SRES").find(
    (candidate) => candidate.registryActivityCode === activityCode,
  );
  if (!method) {
    throw new Error(`Missing SRES calculation catalogue method for ${activityCode}.`);
  }
  const source = activityCode === "PV"
    ? postcodeZoneRuleForActivity(activityCode).source
    : activityCode === "WIND" || activityCode === "HYDRO"
      ? REGULATIONS_SGU
      : CALCULATE_COMMON;
  return {
    outputUnit: "STC",
    formulaKey: method.formulaKey,
    formulaSummary: CALCULATOR_FORMULA_SUMMARIES[activityCode],
    inputKeys: CALCULATOR_INPUT_KEYS[activityCode],
    existingCatalogueState: method.state,
    runtimeEstimatorContract: "creditex-stc-deterministic-estimate/v1",
    outputClassification: "runtime_estimate_only_registry_reconciliation_required",
    catalogueQuantity: null,
    officialReconciliationRequired: true,
    certificateActionEnabled: false,
    source,
  };
}

function isCurrentSresTemplate(
  template: GovernmentActivityTemplate,
): template is GovernmentActivityTemplate & {
  registryActivityCode: CreditexCurrentSresActivityCode;
  catalogueState: "current" | "limited";
} {
  return (
    (template.catalogueState === "current" || template.catalogueState === "limited")
    && CREDITEX_CURRENT_SRES_ACTIVITY_CODES.includes(
      template.registryActivityCode as CreditexCurrentSresActivityCode,
    )
  );
}

function buildContentCandidate(
  template: GovernmentActivityTemplate & {
    registryActivityCode: CreditexCurrentSresActivityCode;
    catalogueState: "current" | "limited";
  },
): CreditexSresWorkPackContentCandidate {
  const activityCode = template.registryActivityCode;
  const referenceDocuments = referenceDocumentsForActivity(activityCode);
  return {
    schema: CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA,
    programCode: "SRES",
    templateId: template.templateId,
    activityCode,
    title: template.title,
    catalogueState: template.catalogueState,
    statusDecision: statusDecisionForActivity(activityCode),
    identityBindings: identityBindingsForActivity(activityCode),
    sourceBindings: referenceDocuments,
    prompts: promptsForActivity(activityCode),
    evidenceRequirements: evidenceForActivity(activityCode),
    productDependencies: productDependenciesForActivity(activityCode),
    postcodeZoneRule: postcodeZoneRuleForActivity(activityCode),
    deemingRule: deemingRuleForActivity(activityCode),
    scenarioRules: scenarioRulesForActivity(activityCode),
    calculator: calculatorForActivity(activityCode),
    signatures: signaturesForActivity(activityCode),
    referenceDocuments,
    finalDocumentNeeds: finalDocumentNeedsForActivity(activityCode),
    certificateOutput: {
      unit: "STC",
      classification: "tradable_certificate_after_regulator_registration",
      quantitySource: "runtime_validated_calculation_only",
      creationChannel: "rec_registry_registered_agent_workflow",
      localWorkPackMayCreateCertificate: false,
      source: ACT_ASSIGNMENT,
    },
    gaps: gapsForActivity(activityCode),
    candidateOnly: true,
    independentlyApproved: false,
    published: false,
    activationReady: false,
  };
}

const currentSresTemplates = governmentActivityTemplates("SRES")
  .filter(isCurrentSresTemplate)
  .sort(
    (left, right) =>
      CREDITEX_CURRENT_SRES_ACTIVITY_CODES.indexOf(left.registryActivityCode)
      - CREDITEX_CURRENT_SRES_ACTIVITY_CODES.indexOf(right.registryActivityCode),
  );

export const CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES:
readonly CreditexSresWorkPackContentCandidate[] = currentSresTemplates.map(
  buildContentCandidate,
);

export type CreditexSresWorkPackContentValidation = {
  valid: boolean;
  errors: readonly string[];
  total: number;
  candidateContentCompleteCount: number;
  candidateContentCoveragePercent: number;
  activationReadyCount: number;
  activationCoveragePercent: number;
};

function sourceBindingErrors(
  label: string,
  source: CreditexSresSourceBinding,
): string[] {
  const errors: string[] = [];
  if (!/^source-[a-f0-9]{20}$/.test(source.sourceId)) {
    errors.push(`${label} has an invalid source ID.`);
  }
  if (!/^[a-f0-9]{64}$/.test(source.expectedSha256)) {
    errors.push(`${label} has an invalid SHA-256.`);
  }
  if (!source.citation.trim()) {
    errors.push(`${label} is missing an exact citation.`);
  }
  if (source.operationallyApproved !== false) {
    errors.push(`${label} must remain operationally unapproved.`);
  }
  return errors;
}

function candidateSourceBindings(
  candidate: CreditexSresWorkPackContentCandidate,
): readonly { label: string; source: CreditexSresSourceBinding }[] {
  return [
    { label: "status decision", source: candidate.statusDecision.source },
    ...candidate.sourceBindings.map((source) => ({ label: "source binding", source })),
    ...candidate.prompts.map((prompt) => ({ label: `prompt ${prompt.key}`, source: prompt.source })),
    ...candidate.evidenceRequirements.map((evidence) => ({
      label: `evidence ${evidence.requirementId}`,
      source: evidence.source,
    })),
    ...candidate.productDependencies.map((dependency) => ({
      label: `product ${dependency.productKind}`,
      source: dependency.source,
    })),
    { label: "postcode zone rule", source: candidate.postcodeZoneRule.source },
    { label: "deeming rule", source: candidate.deemingRule.source },
    { label: "scenario rule", source: candidate.scenarioRules.source },
    { label: "calculator", source: candidate.calculator.source },
    ...candidate.signatures.map((signature) => ({
      label: `signature ${signature.signatureId}`,
      source: signature.source,
    })),
    ...candidate.referenceDocuments.map((source) => ({ label: "reference document", source })),
    ...candidate.finalDocumentNeeds.map((document) => ({
      label: `final document ${document.documentType}`,
      source: document.source,
    })),
    { label: "certificate output", source: candidate.certificateOutput.source },
  ];
}

function hasCompleteCandidateContent(
  candidate: CreditexSresWorkPackContentCandidate,
): boolean {
  return candidate.sourceBindings.length > 0
    && candidate.prompts.length > 0
    && candidate.evidenceRequirements.length > 0
    && candidate.productDependencies.length > 0
    && candidate.productDependencies.every(
      (dependency) => dependency.requiredSnapshotFields.length > 0,
    )
    && candidate.postcodeZoneRule.postcodeRequired
    && candidate.deemingRule.installationYears.length > 0
    && candidate.deemingRule.sourceOptions.length > 0
    && candidate.scenarioRules.sourceOptions.length > 0
    && candidate.calculator.formulaKey.length > 0
    && candidate.calculator.inputKeys.length > 0
    && candidate.signatures.length > 0
    && candidate.referenceDocuments.length > 0
    && candidate.finalDocumentNeeds.length > 0
    && candidate.gaps.length > 0;
}

function hasProductKinds(
  candidate: CreditexSresWorkPackContentCandidate,
  kinds: readonly CreditexSresProductDependency["productKind"][],
): boolean {
  const actual = candidate.productDependencies.map((dependency) => dependency.productKind);
  return kinds.every((kind) => actual.includes(kind));
}

export function validateCreditexSresWorkPackContentCandidate(
  candidates: readonly CreditexSresWorkPackContentCandidate[] =
    CREDITEX_SRES_WORK_PACK_CONTENT_CANDIDATES,
): CreditexSresWorkPackContentValidation {
  const errors: string[] = [];
  const expectedCodes = [...CREDITEX_CURRENT_SRES_ACTIVITY_CODES];
  const actualCodes = candidates.map((candidate) => candidate.activityCode);
  const uniqueCodes = new Set(actualCodes);
  const uniqueTemplateIds = new Set(candidates.map((candidate) => candidate.templateId));
  const knownSourcesById = new Map<string, CreditexSresOfficialSource>(
    Object.values(CREDITEX_SRES_OFFICIAL_SOURCE_LIBRARY).map((source) => [
      source.sourceId,
      source,
    ]),
  );
  const calculationMethods = new Map(
    governmentActivityCalculationMethods("SRES").map((method) => [
      method.registryActivityCode,
      method,
    ]),
  );

  if (candidates.length !== expectedCodes.length) {
    errors.push(`Expected ${expectedCodes.length} current SRES candidates, received ${candidates.length}.`);
  }
  if (uniqueCodes.size !== candidates.length) {
    errors.push("SRES candidate activity codes must be unique.");
  }
  if (uniqueTemplateIds.size !== candidates.length) {
    errors.push("SRES candidate template IDs must be unique.");
  }
  if (actualCodes.join("|") !== expectedCodes.join("|")) {
    errors.push("SRES candidate activity codes do not exactly match the current ordered catalogue.");
  }

  for (const candidate of candidates) {
    const prefix = `SRES ${candidate.activityCode}`;
    const method = calculationMethods.get(candidate.activityCode);
    if (candidate.schema !== CREDITEX_SRES_WORK_PACK_CONTENT_SCHEMA) {
      errors.push(`${prefix} has an invalid schema.`);
    }
    if (!hasCompleteCandidateContent(candidate)) {
      errors.push(`${prefix} is missing one or more required candidate-content sections.`);
    }
    if (
      candidate.candidateOnly !== true
      || candidate.independentlyApproved !== false
      || candidate.published !== false
      || candidate.activationReady !== false
    ) {
      errors.push(`${prefix} must remain an unapproved, unpublished, activation-blocked candidate.`);
    }
    if (candidate.gaps.some((gap) => gap.blocksActivation !== true)) {
      errors.push(`${prefix} contains a gap that does not fail closed.`);
    }
    if (new Set(candidate.gaps.map((gap) => gap.code)).size !== candidate.gaps.length) {
      errors.push(`${prefix} contains duplicate gap codes.`);
    }
    if (
      !candidate.signatures.every(
        (signature) => signature.visibleSignatureBox && signature.autofillIntoFinalPdf,
      )
    ) {
      errors.push(`${prefix} must render and autofill every signature into the final PDF.`);
    }
    if (
      candidate.identityBindings.registeredAgent !== "creditex_provider_for_job"
      || candidate.identityBindings.installerBusiness !== "assigned_trade_business_for_job"
      || candidate.identityBindings.assignedTechnician !== "assigned_trade_technician_for_appointment"
      || candidate.identityBindings.systemOwner !== "job_system_owner_or_authorised_signatory"
    ) {
      errors.push(`${prefix} has invalid provider, owner, trade-business or technician identity bindings.`);
    }
    if (
      candidate.scenarioRules.officialScenarioCode !== null
      || candidate.scenarioRules.classification
        !== "no_separate_scenario_code_use_source_options"
    ) {
      errors.push(`${prefix} must use exact source options without inventing an SRES scenario code.`);
    }
    if (!method) {
      errors.push(`${prefix} has no existing calculation catalogue method.`);
    } else if (
      candidate.calculator.formulaKey !== method.formulaKey
      || candidate.calculator.existingCatalogueState !== method.state
      || candidate.calculator.officialReconciliationRequired
        !== method.officialReconciliationRequired
      || candidate.calculator.certificateActionEnabled !== method.certificateActionEnabled
    ) {
      errors.push(`${prefix} does not match the existing calculation catalogue contract.`);
    }
    if (
      candidate.calculator.catalogueQuantity !== null
      || candidate.calculator.certificateActionEnabled
      || candidate.certificateOutput.localWorkPackMayCreateCertificate
      || candidate.certificateOutput.quantitySource !== "runtime_validated_calculation_only"
    ) {
      errors.push(`${prefix} contains an unauthorised certificate quantity or creation path.`);
    }
    for (const evidence of candidate.evidenceRequirements) {
      if (
        evidence.preserveOriginalMetadata
        !== (evidence.kind === "geotagged_photograph")
      ) {
        errors.push(`${prefix} ${evidence.requirementId} has an invalid metadata-retention rule.`);
      }
    }
    for (const binding of candidateSourceBindings(candidate)) {
      const knownSource = knownSourcesById.get(binding.source.sourceId);
      if (!knownSource) {
        errors.push(`${prefix} ${binding.label} references an unknown custody source.`);
      } else if (
        binding.source.expectedSha256 !== knownSource.expectedSha256
        || binding.source.officialUrl !== knownSource.officialUrl
        || binding.source.expectedContentType !== knownSource.expectedContentType
        || binding.source.expectedSizeBytes !== knownSource.expectedSizeBytes
      ) {
        errors.push(`${prefix} ${binding.label} does not match its custody source identity.`);
      }
      errors.push(...sourceBindingErrors(`${prefix} ${binding.label}`, binding.source));
    }
  }

  const byCode = new Map(candidates.map((candidate) => [candidate.activityCode, candidate]));
  const pv = byCode.get("PV");
  if (
    !pv
    || !hasProductKinds(pv, ["cec_approved_pv_module_csv", "cec_approved_inverter_csv"])
    || pv.postcodeZoneRule.zoneApplicability !== "solar_pv_zone_rating_required"
    || pv.postcodeZoneRule.zoneCount !== 4
    || pv.postcodeZoneRule.ratingValues.join("|") !== "1.622|1.536|1.382|1.185"
    || pv.deemingRule.applicability !== "one_five_or_maximum_period"
  ) {
    errors.push("SRES PV product, postcode-zone or deeming dependencies are incomplete.");
  }
  const battery = byCode.get("BESS");
  if (
    !battery
    || !hasProductKinds(battery, ["cec_approved_solar_battery_csv", "cec_approved_inverter_csv"])
    || battery.postcodeZoneRule.zoneApplicability !== "not_used_in_certificate_arithmetic"
    || battery.deemingRule.applicability !== "not_applicable_battery_date_factor"
    || !battery.gaps.some(
      (gap) => gap.code === "SRES_BATTERY_PRE_2025_REPLACEMENT_EXPANSION_CONTRACT_MISSING",
    )
  ) {
    errors.push("SRES BESS product, address, factor or replacement/expansion dependencies are incomplete.");
  }
  for (const code of ["WIND", "HYDRO"] as const) {
    const candidate = byCode.get(code);
    if (
      !candidate
      || !hasProductKinds(candidate, ["wind_or_hydro_equipment_identity", "cec_approved_inverter_csv"])
      || candidate.postcodeZoneRule.zoneApplicability !== "not_used_in_certificate_arithmetic"
      || candidate.deemingRule.applicability !== "one_or_current_maximum_period"
    ) {
      errors.push(`SRES ${code} product, site-resource or deeming dependencies are incomplete.`);
    }
  }
  const swh = byCode.get("SWH");
  if (
    !swh
    || !hasProductKinds(swh, ["cer_swh_under_700l_register_csv", "cer_swh_over_700l_register_csv"])
    || swh.postcodeZoneRule.zoneCount !== 4
    || swh.deemingRule.applicability !== "registered_ten_year_entitlement_multiplier"
    || !swh.evidenceRequirements.some(
      (evidence) => evidence.requirementId === "swh_over_700l_owner_declaration",
    )
    || swh.evidenceRequirements.filter(
      (evidence) => evidence.alternativeGroup?.groupId === "swh_invoice_or_dated_unit_photo",
    ).length !== 2
  ) {
    errors.push("SRES SWH register, zone, deeming or over-700-litre document dependencies are incomplete.");
  }
  const ashp = byCode.get("ASHP");
  if (
    !ashp
    || !hasProductKinds(ashp, ["cer_ashp_register_csv"])
    || ashp.postcodeZoneRule.zoneCount !== 5
    || ashp.deemingRule.applicability !== "registered_ten_year_entitlement_multiplier"
    || ashp.evidenceRequirements.filter(
      (evidence) => evidence.alternativeGroup?.groupId === "ashp_invoice_or_dated_unit_photo",
    ).length !== 2
  ) {
    errors.push("SRES ASHP register, zone or deeming dependencies are incomplete.");
  }

  const candidateContentCompleteCount = candidates.filter(
    hasCompleteCandidateContent,
  ).length;
  const activationReadyCount = candidates.filter(
    (candidate) => candidate.activationReady,
  ).length;
  const total = candidates.length;
  return {
    valid: errors.length === 0,
    errors,
    total,
    candidateContentCompleteCount,
    candidateContentCoveragePercent:
      total === 0 ? 0 : Math.round((candidateContentCompleteCount / total) * 100),
    activationReadyCount,
    activationCoveragePercent:
      total === 0 ? 0 : Math.round((activationReadyCount / total) * 100),
  };
}

export const CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexSresWorkPackContentCandidate();

if (!CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(
    `Invalid Creditex SRES work-pack candidate content: ${CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.errors.join(" ")}`,
  );
}

export const CREDITEX_SRES_WORK_PACK_CONTENT_COMPLETENESS = {
  expectedCurrentActivityTemplates: CREDITEX_CURRENT_SRES_ACTIVITY_CODES.length,
  machineReadableCandidateTemplates:
    CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.candidateContentCompleteCount,
  machineReadableCandidateCoveragePercent:
    CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.candidateContentCoveragePercent,
  independentlyApprovedActivationTemplates:
    CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.activationReadyCount,
  independentlyApprovedActivationCoveragePercent:
    CREDITEX_SRES_WORK_PACK_CONTENT_VALIDATION.activationCoveragePercent,
  publicationState: "candidate_not_approved" as const,
} as const;
