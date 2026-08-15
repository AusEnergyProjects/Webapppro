import {
  CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY,
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES,
  type CreditexNswCertificateOfficialSource,
  type CreditexNswCertificateProgramCode,
} from "./creditex-nsw-certificate-work-pack-content.ts";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
  type CreditexNswActivityDefinition,
} from "../lib/creditex-nsw-program-catalogue.ts";

export const CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_SCHEMA =
  "creditex-nsw-governed-work-pack-content/v1" as const;

type NswSourceKey = keyof typeof CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY;

type NswGovernedSource = CreditexNswCertificateOfficialSource & {
  sourceKey: NswSourceKey;
  citation: string;
};

type NswEvidenceCaptureKind =
  | "document_upload"
  | "geotagged_photo"
  | "registry_snapshot"
  | "guided_declaration"
  | "calculation_receipt"
  | "record_link";

type NswEvidenceSpec = Readonly<{
  key: string;
  label: string;
  captureKind: NswEvidenceCaptureKind;
  required: true;
  preserveOriginalBytes: true;
  preserveOriginalMetadata: true;
}>;

type NswPolicyGroup = Readonly<{
  method: "ESS_RULE" | "HEER" | "IHEAB" | "PDRS";
  sourceKey: NswSourceKey;
  citation: string;
  activityCodes: readonly string[];
  evidence: readonly NswEvidenceSpec[];
  signerRoles: readonly (
    | "original_energy_saver_or_capacity_holder"
    | "site_assessor"
    | "installer_or_supervising_qualified_licence_holder"
    | "purchaser"
    | "owner"
  )[];
}>;

function evidence(
  key: string,
  label: string,
  captureKind: NswEvidenceCaptureKind,
): NswEvidenceSpec {
  return {
    key,
    label,
    captureKind,
    required: true,
    preserveOriginalBytes: true,
    preserveOriginalMetadata: true,
  };
}

const HEER_COMMON_EVIDENCE = [
  evidence(
    "implementation-date-address",
    "CCEW or tax invoice showing the implementation date and address",
    "document_upload",
  ),
  evidence(
    "minimum-payment",
    "Tax invoice and sales ledger showing the purchaser, implementation and payment",
    "document_upload",
  ),
  evidence(
    "nomination",
    "Nomination form signed by the original energy saver on or before implementation",
    "guided_declaration",
  ),
  evidence(
    "calculation-record",
    "Calculation record with every activity input and factor",
    "calculation_receipt",
  ),
] as const;

const IHEAB_COMMON_EVIDENCE = [
  evidence(
    "implementation-date-address",
    "Completion or commissioning report, CCEW, GCC or tax invoice showing date and site",
    "document_upload",
  ),
  evidence(
    "energy-saver-invoice",
    "Tax invoice identifying the purchaser, implementation and purchase date",
    "document_upload",
  ),
  evidence(
    "nomination",
    "Nomination form identifying the activity and signed by the original energy saver on or before implementation",
    "guided_declaration",
  ),
  evidence(
    "calculation-record",
    "Calculation record with every Schedule F input and factor",
    "calculation_receipt",
  ),
] as const;

const PDRS_COMMON_EVIDENCE = [
  evidence(
    "capacity-holder",
    "Original capacity-holder evidence or the applicable signed nomination",
    "guided_declaration",
  ),
  evidence(
    "implementation-date",
    "Evidence of installation or onboarding date applicable to the activity",
    "document_upload",
  ),
  evidence(
    "nsw-electricity-network-site",
    "Electricity bill or CCEW linking the site and NMI to the NSW electricity network",
    "document_upload",
  ),
  evidence(
    "calculation-record",
    "Calculation record with every PDRS Rule input, factor and PRC output",
    "calculation_receipt",
  ),
] as const;

function heerGroup(
  activityCodes: readonly string[],
  table: string,
  guidePages: string,
  activityEvidence: readonly NswEvidenceSpec[],
  signerRoles: NswPolicyGroup["signerRoles"] = [
    "original_energy_saver_or_capacity_holder",
    "site_assessor",
    "installer_or_supervising_qualified_licence_holder",
    "purchaser",
  ],
): NswPolicyGroup {
  return {
    method: "HEER",
    sourceKey: "heerGuide",
    citation: `HEER Method Guide v4.8, ${table}, guide pages ${guidePages}.`,
    activityCodes,
    evidence: [...HEER_COMMON_EVIDENCE, ...activityEvidence],
    signerRoles,
  };
}

function iheabGroup(
  activityCodes: readonly string[],
  table: string,
  guidePages: string,
  activityEvidence: readonly NswEvidenceSpec[],
): NswPolicyGroup {
  return {
    method: "IHEAB",
    sourceKey: "iheabGuide",
    citation: `IHEAB Method Guide v4.3, ${table}, guide pages ${guidePages}.`,
    activityCodes,
    evidence: [...IHEAB_COMMON_EVIDENCE, ...activityEvidence],
    signerRoles: [
      "original_energy_saver_or_capacity_holder",
      "installer_or_supervising_qualified_licence_holder",
    ],
  };
}

function pdrsGroup(
  activityCodes: readonly string[],
  table: string,
  guidePages: string,
  activityEvidence: readonly NswEvidenceSpec[],
  signerRoles: NswPolicyGroup["signerRoles"],
): NswPolicyGroup {
  return {
    method: "PDRS",
    sourceKey: "pdrsMethodGuide",
    citation: `PDRS Method Guide v3.0, ${table}, guide pages ${guidePages}.`,
    activityCodes,
    evidence: [...PDRS_COMMON_EVIDENCE, ...activityEvidence],
    signerRoles,
  };
}

const NSW_POLICY_GROUPS: readonly NswPolicyGroup[] = [
  {
    method: "ESS_RULE",
    sourceKey: "essRule",
    citation:
      "ESS Rule effective 1 July 2026, Schedule C, Activity Definitions C1-C2, Rule pages 108-109.",
    activityCodes: ["C1", "C2"],
    evidence: [
      evidence(
        "nomination",
        "Nomination form signed by the original energy saver on or before implementation",
        "guided_declaration",
      ),
      evidence(
        "removed-appliance-identity-condition",
        "Record of refrigerator or freezer class, capacity, working order and primary or spare status",
        "guided_declaration",
      ),
      evidence(
        "removed-appliance-disposal",
        "Original removal and lawful disposal record",
        "document_upload",
      ),
      evidence(
        "calculation-record",
        "Rule calculation record for the number and class of appliances removed",
        "calculation_receipt",
      ),
    ],
    signerRoles: ["original_energy_saver_or_capacity_holder"],
  },
  heerGroup(
    ["D1", "D2"],
    "Table 4.2",
    "20",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("pre-installation-photo", "Geotagged photograph of the existing glazing", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification and warranty", "document_upload"),
      evidence("wers-rating", "WERS certificate or database screenshot", "registry_snapshot"),
      evidence("post-implementation-declaration", "Installer and purchaser post-implementation declaration", "guided_declaration"),
      evidence("installed-equipment-photo", "Geotagged photograph of installed glazing", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["D5"],
    "Table 4.3",
    "21",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-or-empty-site-photo", "Geotagged existing pool-pump or no-existing-equipment photograph", "geotagged_photo"),
      evidence("new-product-identity", "New product make and model evidence", "document_upload"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and star-rating snapshot", "registry_snapshot"),
      evidence("warranty", "Product warranty showing required duration", "document_upload"),
      evidence("post-implementation-declaration", "Installer and purchaser post-implementation declaration", "guided_declaration"),
      evidence("installed-equipment-photo", "Geotagged installed pool-pump photograph", "geotagged_photo"),
      evidence("replacement-disposal", "Disposal receipt or geotagged disposal photograph for a replacement", "document_upload"),
    ],
  ),
  heerGroup(
    ["D13"],
    "Table 4.6",
    "24",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("site-condition-photo", "Geotagged no-existing-equipment and continuous-insulation photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer capacity, flow coefficient, effective aerodynamic area and warranty", "document_upload"),
      evidence("post-implementation-declaration", "Qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-equipment-photo", "Geotagged installed ventilator photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["D14"],
    "Table 4.7",
    "25",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("site-condition-photo", "Geotagged no-existing-equipment and continuous-insulation photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer capacity, flow coefficient, electrical consumption and warranty", "document_upload"),
      evidence("post-implementation-declaration", "Qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-equipment-photo", "Geotagged installed ventilator photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["D15"],
    "Table 4.8",
    "26",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-exhaust-photo", "Geotagged existing fan, ducting and exterior outlet photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification, warranty and installation instructions", "document_upload"),
      evidence("post-implementation-declaration", "Qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-exhaust-photo", "Geotagged installed fan, ducting and exterior outlet photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["D16"],
    "Table 4.9",
    "27",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-or-empty-site-photo", "Geotagged existing air-conditioner or no-existing-equipment photograph", "geotagged_photo"),
      evidence("new-product-identity", "Indoor and outdoor make and model evidence", "document_upload"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and required performance fields", "registry_snapshot"),
      evidence("post-implementation-declaration", "Template-based qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-equipment-photo", "Geotagged installed air-conditioner photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["D17", "D18", "D19", "D20"],
    "Table 4.10",
    "28",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-water-heater-photo", "Geotagged existing water-heater type photograph", "geotagged_photo"),
      evidence("new-product-invoice", "Tax invoice showing product make and model", "document_upload"),
      evidence("accepted-product-snapshot", "Implementation-date Scheme Administrator product acceptance", "registry_snapshot"),
      evidence("post-implementation-declaration", "Qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-water-heater-photo", "Geotagged installed make and model photograph", "geotagged_photo"),
      evidence("manual-location-evidence", "Heat-pump user manual and location-compliance photographs where applicable", "document_upload"),
      evidence("warranty", "Applicable heat-pump unit and tank warranty", "document_upload"),
    ],
  ),
  heerGroup(
    ["E1"],
    "Table 4.11",
    "29-30",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-lighting-photo", "Geotagged existing lighting and applicable transformer or dimmer photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification and compatibility list", "document_upload"),
      evidence("product-acceptance", "Applicable Scheme Administrator product acceptance", "registry_snapshot"),
      evidence("electrician-compatibility", "Applicable electrician dimmer or transformer compatibility declaration", "guided_declaration"),
      evidence("post-implementation-declaration", "Licensed electrician and purchaser declaration", "guided_declaration"),
      evidence("installed-lighting-photo", "Geotagged installed lighting photograph", "geotagged_photo"),
      evidence("recycling", "Lighting recycling receipt or certificate", "document_upload"),
    ],
  ),
  heerGroup(
    ["E2", "E3", "E4", "E5"],
    "Table 4.12",
    "31",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-lighting-photo", "Geotagged existing lighting photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification", "document_upload"),
      evidence("product-acceptance", "Applicable Scheme Administrator product acceptance", "registry_snapshot"),
      evidence("electrician-dimmer-compatibility", "Applicable electrician dimmer compatibility declaration", "guided_declaration"),
      evidence("post-implementation-declaration", "Licensed electrician and purchaser declaration", "guided_declaration"),
      evidence("installed-lighting-photo", "Geotagged installed lighting photograph", "geotagged_photo"),
      evidence("recycling", "Lighting recycling receipt or certificate", "document_upload"),
    ],
  ),
  heerGroup(
    ["E6"],
    "Table 4.13",
    "32",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-water-system-photo", "Geotagged hot-water system and existing showerhead photographs", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification and warranty", "document_upload"),
      evidence("wels-snapshot", "WELS showerhead rating snapshot", "registry_snapshot"),
      evidence("post-implementation-declaration", "Licensed plumber and purchaser declaration", "guided_declaration"),
      evidence("installed-showerhead-photo", "Geotagged installed showerhead photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["E7", "E8"],
    "Table 4.14",
    "33",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-opening-photo", "Geotagged existing door or window photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification, warranty and installation instructions", "document_upload"),
      evidence("post-implementation-declaration", "Installer and purchaser declaration", "guided_declaration"),
      evidence("installed-draught-proofing-photo", "Geotagged installed product photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["E9"],
    "Table 4.15",
    "34",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-fireplace-photo", "Geotagged existing fireplace and damper condition photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification, operable-fireplace status, warranty and instructions", "document_upload"),
      evidence("post-implementation-declaration", "Installer and purchaser declaration", "guided_declaration"),
      evidence("installed-damper-photo", "Geotagged installed damper and applicable sealing or tagging photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["E10"],
    "Table 4.16",
    "35",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-window-photo", "Geotagged unshaded window or door photograph", "geotagged_photo"),
      evidence("orientation-map", "Map or satellite image showing site location and orientation", "document_upload"),
      evidence("manufacturer-specification", "Manufacturer specification, five-year warranty and instructions", "document_upload"),
      evidence("post-implementation-declaration", "Installer or supervisor and purchaser declaration", "guided_declaration"),
      evidence("installed-blind-photo", "Geotagged installed external blind photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["E11"],
    "Table 4.17",
    "36",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-lighting-photo", "Geotagged existing fixture, dimmer and light-output photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification and dimmer compatibility list", "document_upload"),
      evidence("product-acceptance", "Applicable Scheme Administrator product acceptance", "registry_snapshot"),
      evidence("electrician-dimmer-compatibility", "Applicable electrician dimmer compatibility declaration", "guided_declaration"),
      evidence("post-implementation-declaration", "Licensed electrician and purchaser declaration", "guided_declaration"),
      evidence("installed-lighting-photo", "Geotagged installed lamp photograph", "geotagged_photo"),
      evidence("recycling", "Lighting recycling receipt or certificate", "document_upload"),
    ],
  ),
  heerGroup(
    ["E12"],
    "Table 4.18",
    "37",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-exhaust-photo", "Geotagged existing exhaust fan photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification, two-year warranty and instructions", "document_upload"),
      evidence("post-implementation-declaration", "Qualified licence holder and purchaser declaration", "guided_declaration"),
      evidence("installed-sealing-photo", "Geotagged installed sealing product and airflow-restriction photograph", "geotagged_photo"),
    ],
  ),
  heerGroup(
    ["E13"],
    "Table 4.19",
    "38",
    [
      evidence("site-assessor-declaration", "Signed site assessor declaration", "guided_declaration"),
      evidence("existing-lighting-photo", "Geotagged existing T5 lighting photograph", "geotagged_photo"),
      evidence("manufacturer-specification", "Manufacturer specification", "document_upload"),
      evidence("product-acceptance", "Applicable Scheme Administrator product acceptance", "registry_snapshot"),
      evidence("electrician-dimmer-compatibility", "Applicable electrician dimmer compatibility declaration", "guided_declaration"),
      evidence("post-implementation-declaration", "Licensed electrician and purchaser declaration", "guided_declaration"),
      evidence("installed-lighting-photo", "Geotagged installed LED luminaire photograph", "geotagged_photo"),
      evidence("recycling", "Lighting recycling receipt or certificate", "document_upload"),
    ],
  ),
  iheabGroup(
    ["F1.1"],
    "Table 4.2",
    "15-16",
    [
      evidence("new-cabinet-identity", "New cabinet make and model", "document_upload"),
      evidence("payment", "Tax invoice and sales ledger", "document_upload"),
      evidence("gems-snapshot", "GEMS or NZ registry EEI and product-class snapshot", "registry_snapshot"),
      evidence("display-sides-photo", "Geotagged display-side construction photograph", "geotagged_photo"),
      evidence("installation-photo", "Geotagged empty-site and installed-cabinet photographs", "geotagged_photo"),
      evidence("installer-declaration", "Signed installer declaration, CCEW or commissioning report", "guided_declaration"),
    ],
  ),
  iheabGroup(
    ["F1.2"],
    "Table 4.3",
    "17-18",
    [
      evidence("replacement-cabinet-identity", "Replacement and existing cabinet make and model", "document_upload"),
      evidence("payment", "Tax invoice and sales ledger", "document_upload"),
      evidence("gems-snapshot", "GEMS or NZ registry EEI, product class and existing-product evidence", "registry_snapshot"),
      evidence("replacement-sequence-photo", "Geotagged existing, removed and installed cabinet photographs", "geotagged_photo"),
      evidence("disposal", "Recycling or disposal receipt", "document_upload"),
      evidence("installer-declaration", "Signed installer declaration, CCEW or commissioning report", "guided_declaration"),
    ],
  ),
  iheabGroup(
    ["F2", "F3"],
    "Table 4.4",
    "19",
    [
      evidence("appliance-identity", "Appliance make and model", "document_upload"),
      evidence("gems-snapshot", "GEMS registration and applicable IPLV or EER values", "registry_snapshot"),
      evidence("installation-photo", "Geotagged installed appliance photograph", "geotagged_photo"),
      evidence("installation-record", "Tax invoice, CCEW or commissioning report", "document_upload"),
    ],
  ),
  iheabGroup(
    ["F4"],
    "Table 4.5",
    "20-21",
    [
      evidence("site-assessment-report", "Installer and original energy saver signed site assessment report", "guided_declaration"),
      evidence("appliance-identity", "Manufacturer specification, tax invoice and geotagged identity photographs", "document_upload"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and commercial performance fields", "registry_snapshot"),
      evidence("payment", "Minimum co-payment tax invoice and sales ledger", "document_upload"),
      evidence("installation-photo", "Geotagged existing or empty-site and installed-equipment photographs", "geotagged_photo"),
      evidence("installer-declaration", "Signed installer declaration, CCEW or commissioning report", "guided_declaration"),
    ],
  ),
  iheabGroup(
    ["F5", "F6", "F7"],
    "Tables 4.6-4.8",
    "21-26",
    [
      evidence("new-motor-data", "Tax invoice and manufacturer data for the new motor", "document_upload"),
      evidence("existing-motor-data", "Manufacturer data and geotagged existing-motor photographs where replacing", "document_upload"),
      evidence("load-utilisation", "Applicable process or system load-utilisation evidence", "document_upload"),
      evidence("installation-photo", "Geotagged installed-motor photograph", "geotagged_photo"),
      evidence("installer-declaration", "Signed installer declaration and applicable tax invoice, CCEW or commissioning report", "guided_declaration"),
    ],
  ),
  iheabGroup(
    ["F10", "F11", "F12", "F13", "F14", "F15"],
    "Tables 4.10-4.14",
    "28-39",
    [
      evidence("site-assessment-report", "Installer or original energy saver signed site assessment report", "guided_declaration"),
      evidence("new-equipment-data", "New equipment nameplate photographs and manufacturer data", "document_upload"),
      evidence("existing-boiler-data", "Existing boiler, heater and burner photographs and manufacturer data", "document_upload"),
      evidence("installation-photo", "Geotagged pre- and post-installation equipment photographs", "geotagged_photo"),
      evidence("installer-declaration", "Signed installer declaration and applicable GCC or commissioning report", "guided_declaration"),
    ],
  ),
  iheabGroup(
    ["F16", "F17"],
    "Tables 4.15-4.16",
    "40-43",
    [
      evidence("site-assessment-report", "Installer or original energy saver signed site assessment report", "guided_declaration"),
      evidence("payment", "Tax invoice and sales ledger", "document_upload"),
      evidence("product-identity", "Tax invoice identifying the new heat-pump water heater", "document_upload"),
      evidence("installation-photo", "Geotagged new and applicable existing-equipment photographs", "geotagged_photo"),
      evidence("installer-declaration", "Signed installer declaration or commissioning report", "guided_declaration"),
      evidence("manual-location-evidence", "User manual and location-compliance photograph", "document_upload"),
      evidence("warranty", "Applicable heat-pump unit and tank warranty", "document_upload"),
      evidence("customer-factsheet", "Evidence the current heat-pump factsheet was given before implementation", "document_upload"),
    ],
  ),
  pdrsGroup(
    ["HVAC1"],
    "Table B.2",
    "63-64",
    [
      evidence("site-assessor-declaration", "Site assessor declaration", "guided_declaration"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and required performance fields", "registry_snapshot"),
      evidence("equipment-identity", "Manufacturer combination data and geotagged indoor and outdoor identity photographs", "document_upload"),
      evidence("existing-removal", "Post-implementation declaration or geotagged removal sequence", "guided_declaration"),
      evidence("installation-standard", "Installer declaration, heat-load report or commissioning measurements for AS/NZS 5141:2018", "document_upload"),
      evidence("licence", "Post-implementation declaration, licence receipt or CCEW", "document_upload"),
    ],
    [
      "original_energy_saver_or_capacity_holder",
      "site_assessor",
      "installer_or_supervising_qualified_licence_holder",
      "purchaser",
    ],
  ),
  pdrsGroup(
    ["HVAC2"],
    "Table B.3",
    "65-66",
    [
      evidence("site-eligibility", "Large-business or allowed Class 2 central-system site evidence", "document_upload"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and required performance fields", "registry_snapshot"),
      evidence("equipment-identity", "Manufacturer combination data and geotagged equipment identity photographs", "document_upload"),
      evidence("existing-removal", "Installer declaration or geotagged removal sequence", "guided_declaration"),
      evidence("new-installation", "Installer declaration or geotagged installed-equipment photograph", "guided_declaration"),
      evidence("licence", "Installer declaration, licence receipt or CCEW", "document_upload"),
    ],
    [
      "original_energy_saver_or_capacity_holder",
      "installer_or_supervising_qualified_licence_holder",
    ],
  ),
  pdrsGroup(
    ["RF2"],
    "Table B.5",
    "68",
    [
      evidence("gems-snapshot", "Implementation-date GEMS product-class and EEI snapshot", "registry_snapshot"),
      evidence("display-sides-photo", "Geotagged display-side construction photograph", "geotagged_photo"),
      evidence("existing-class", "Existing and replacement cabinet class and identity evidence", "document_upload"),
      evidence("replacement-sequence", "Installer declaration or geotagged removal and installation sequence", "guided_declaration"),
      evidence("licence", "Installer declaration, licence receipt or CCEW", "document_upload"),
    ],
    [
      "original_energy_saver_or_capacity_holder",
      "installer_or_supervising_qualified_licence_holder",
    ],
  ),
  pdrsGroup(
    ["SYS2"],
    "Table B.6",
    "69",
    [
      evidence("site-assessor-declaration", "Site assessor declaration", "guided_declaration"),
      evidence("gems-snapshot", "Implementation-date GEMS registration and four-star minimum snapshot", "registry_snapshot"),
      evidence("warranty", "Three-year minimum warranty", "document_upload"),
      evidence("replacement-sequence", "Post-implementation declaration or geotagged removal and installation sequence", "guided_declaration"),
      evidence("licence", "Qualified licence holder declaration, licence receipt or CCEW", "document_upload"),
    ],
    [
      "original_energy_saver_or_capacity_holder",
      "site_assessor",
      "installer_or_supervising_qualified_licence_holder",
      "purchaser",
    ],
  ),
  pdrsGroup(
    ["BESS1"],
    "Table B.7",
    "70-73",
    [
      evidence("minimum-payment-or-exemption", "Battery-unit payment evidence or approved exemption evidence", "document_upload"),
      evidence("eligible-delivery-path", "Government-owned and managed site or Exempt Energy Program evidence", "document_upload"),
      evidence("no-existing-battery", "Householder and installer declaration or pre-installation switchboard photograph", "guided_declaration"),
      evidence("solar-pv-at-nmi", "Solar PV evidence at the same NMI", "document_upload"),
      evidence("cec-product-snapshot", "Implementation-date CEC battery list, usable capacity and installed identity evidence", "registry_snapshot"),
      evidence("internet-control", "Internet connectivity and DRA controllability evidence", "document_upload"),
      evidence("warranty", "Battery and inverter warranty evidence", "document_upload"),
      evidence("as-nzs-5139", "Installer declaration, prescribed photographs, site map, risk assessment and signage evidence", "guided_declaration"),
      evidence("installer-accreditation", "Implementation-date approved installer, accreditation, licence and on-site selfie evidence", "registry_snapshot"),
      evidence("smoke-alarm", "Applicable AS 3786 smoke-alarm location and installer declaration", "guided_declaration"),
      evidence("pv-capacity", "Solar PV system size and inverter-capacity evidence", "document_upload"),
      evidence("factsheet-delivery", "Customer factsheet delivery evidence", "document_upload"),
    ],
    [
      "original_energy_saver_or_capacity_holder",
      "installer_or_supervising_qualified_licence_holder",
      "purchaser",
    ],
  ),
  pdrsGroup(
    ["BESS2"],
    "Table B.11",
    "84-86",
    [
      evidence("site-class", "Class 1 building or small-business-site evidence", "document_upload"),
      evidence("demand-response-contract", "Signed qualifying 12-month demand-response contract", "document_upload"),
      evidence("aggregator-capacity", "Market Participant or Network Service Provider aggregation evidence", "document_upload"),
      evidence("onboarding", "Operational DRA onboarding and remote-command evidence", "document_upload"),
      evidence("existing-battery-photo", "Geotagged existing battery photograph", "geotagged_photo"),
      evidence("no-life-support-declaration", "Owner declaration that no life-support equipment is used at the site", "guided_declaration"),
      evidence("cec-product-snapshot", "Onboarding-date CEC battery list and usable-capacity evidence", "registry_snapshot"),
      evidence("warranty", "Battery installation-date and warranty evidence", "document_upload"),
      evidence("warranty-control", "Evidence DRA control does not void or diminish warranty", "document_upload"),
      evidence("factsheet-delivery", "Customer declaration or email evidence of factsheet delivery at quotation", "document_upload"),
    ],
    ["original_energy_saver_or_capacity_holder", "owner"],
  ),
] as const;

const POLICY_BY_ACTIVITY = new Map<string, NswPolicyGroup>(
  NSW_POLICY_GROUPS.flatMap((group) =>
    group.activityCodes.map((activityCode) => [activityCode, group] as const),
  ),
);

function source(sourceKey: NswSourceKey, citation: string): NswGovernedSource {
  return {
    ...CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY[sourceKey],
    sourceKey,
    citation,
  };
}

function localDefinitions(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
) {
  return CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === `${programCode}-2026`,
  )?.activities.filter(
    (definition) => definition.officialActivityCode === activityCode,
  ) ?? [];
}

function formulaSource(
  programCode: CreditexNswCertificateProgramCode,
  definition: CreditexNswActivityDefinition,
) {
  const sourceKey = programCode === "NSW-ESS" ? "essRule" : "pdrsRule";
  const retainedUrl = CREDITEX_NSW_CERTIFICATE_OFFICIAL_SOURCE_LIBRARY[sourceKey].officialUrl;
  const references = definition.sourceReferences.filter(
    (reference) => reference.url === retainedUrl,
  );
  return source(
    sourceKey,
    references.map((reference) =>
      `${reference.title}; ${reference.clauses}; ${reference.pages}`
    ).join(" | "),
  );
}

function commonFormFields(programCode: CreditexNswCertificateProgramCode) {
  const nominationCitation =
    "Nomination Form v1.1, Sections 1-5 and signature table. The exact template applies to every ESS and PDRS method except BESS2.";
  return [
    {
      key: "customer_or_capacity_holder",
      label: "Original energy saver or capacity holder",
      inputType: "record" as const,
      required: true as const,
      prefillFrom: "job.customer" as const,
      source: source("nominationForm", nominationCitation),
    },
    {
      key: "implementation_site",
      label: "Implementation site address",
      inputType: "address" as const,
      required: true as const,
      prefillFrom: "job.site" as const,
      source: source("nominationForm", nominationCitation),
    },
    {
      key: "activity_and_equipment_description",
      label: "Full activity and installed or removed equipment description and quantity",
      inputType: "textarea" as const,
      required: true as const,
      prefillFrom: "work_pack.activity_and_products" as const,
      source: source("nominationForm", nominationCitation),
    },
    {
      key: "creditex_acp_identity",
      label: "Creditex ACP identity, accreditation and contact details",
      inputType: "record" as const,
      required: true as const,
      prefillFrom: "job.creditex_provider" as const,
      source: source("nominationForm", nominationCitation),
    },
    {
      key: "prior_nomination",
      label: "Prior energy saver or capacity-holder nomination at this site",
      inputType: "yes_no_with_detail" as const,
      required: true as const,
      prefillFrom: "operator" as const,
      source: source("nominationForm", nominationCitation),
    },
    {
      key: "assigned_trade_and_technician",
      label: "Assigned installer business and technician",
      inputType: "record" as const,
      required: true as const,
      prefillFrom: "job.assignment" as const,
      source: source(
        programCode === "NSW-ESS" ? "generalAcpGuide" : "pdrsMethodGuide",
        programCode === "NSW-ESS"
          ? "General Requirements Guide for ACPs v1.3, representative and record-keeping requirements."
          : "PDRS Method Guide v3.0, record-keeping and representative requirements.",
      ),
    },
  ] as const;
}

function declarationDocuments(
  programCode: CreditexNswCertificateProgramCode,
  activityCode: string,
  policy: NswPolicyGroup,
) {
  const documents = [];
  if (activityCode !== "BESS2") {
    documents.push({
      documentKey: "nomination-form",
      label: "Energy saver or capacity-holder nomination",
      outputFormat: "retained_pdf" as const,
      templateMode: "exact_official_template" as const,
      source: source(
        "nominationForm",
        "Nomination Form v1.1, exact wording on form pages 3-4 and signature table.",
      ),
    });
  }
  if (policy.method === "HEER" || activityCode === "HVAC1" || activityCode === "SYS2") {
    documents.push(
      {
        documentKey: "site-assessor-declaration",
        label: "Site assessor declaration",
        outputFormat: "retained_pdf" as const,
        templateMode: "exact_official_template" as const,
        source: source(
          "siteAssessorDeclaration",
          "Site Assessor Declaration v2.2, site assessor/site details, applicable activity and declaration signature.",
        ),
      },
      {
        documentKey: "post-implementation-declaration",
        label: "Post-implementation declaration",
        outputFormat: "retained_pdf" as const,
        templateMode: "exact_official_template" as const,
        source: source(
          "postImplementationDeclaration",
          "Post Implementation Declaration v2.2, installer/site details, applicable activity, installer declaration, purchaser declaration and signature tables.",
        ),
      },
    );
  } else if (policy.signerRoles.includes("installer_or_supervising_qualified_licence_holder")) {
    documents.push({
      documentKey: "installer-declaration",
      label: "Activity-specific installer declaration",
      outputFormat: "retained_pdf" as const,
      templateMode: "source_transcribed_governed_template" as const,
      source: source(policy.sourceKey, policy.citation),
    });
  }
  documents.push({
    documentKey: "governed-evidence-and-calculation-packet",
    label: `${programCode} ${activityCode} governed evidence and calculation packet`,
    outputFormat: "retained_pdf_and_originals" as const,
    templateMode: "source_transcribed_governed_template" as const,
    source: source(policy.sourceKey, policy.citation),
  });
  return documents;
}

function hasCompleteRetainedOfficialFieldForms(
  activityCode: string,
  policy: NswPolicyGroup,
) {
  return policy.method === "HEER" || activityCode === "HVAC1" || activityCode === "SYS2";
}

function createGovernedCandidate(
  candidate: (typeof CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES)[number],
) {
  const policy = POLICY_BY_ACTIVITY.get(candidate.registryActivityCode);
  if (!policy) {
    throw new Error(`Missing NSW source-transcribed policy for ${candidate.templateId}.`);
  }
  const definitions = localDefinitions(
    candidate.programCode,
    candidate.registryActivityCode,
  );
  const evidenceSource = source(policy.sourceKey, policy.citation);
  const productValues = [...new Set(
    definitions.flatMap((definition) => definition.productKinds),
  )].sort();
  const registryRequirements = [...new Set(
    definitions.flatMap((definition) => definition.productRegistryRequirements),
  )].sort();
  const scenarioValues = [...new Set(
    definitions.map((definition) => definition.supportedScenario),
  )].sort();
  const sourceDocuments = [
    source(
      candidate.programCode === "NSW-ESS" ? "essRule" : "pdrsRule",
      `${candidate.programCode} ${candidate.registryActivityCode} exact Rule activity definition and effective 1 July 2026 status source.`,
    ),
    evidenceSource,
  ];
  if (candidate.registryActivityCode !== "BESS2") {
    sourceDocuments.push(source(
      "nominationForm",
      "Nomination Form v1.1 applies to this activity and supplies exact nomination wording and signature placement.",
    ));
  }
  if (policy.method === "HEER" || candidate.registryActivityCode === "HVAC1" || candidate.registryActivityCode === "SYS2") {
    sourceDocuments.push(
      source("siteAssessorDeclaration", "Site Assessor Declaration v2.2 applies to this activity."),
      source("postImplementationDeclaration", "Post Implementation Declaration v2.2 applies to this activity."),
    );
  }
  if (candidate.registryActivityCode === "F16" || candidate.registryActivityCode === "F17") {
    sourceDocuments.push(source(
      "iheabHeatPumpFactsheet",
      "IHEAB heat-pump water-heater factsheet v2.2, customer delivery evidence required by IHEAB Method Guide v4.3.",
    ));
  }

  const completeRetainedOfficialFieldForms = hasCompleteRetainedOfficialFieldForms(
    candidate.registryActivityCode,
    policy,
  );

  const blockers = [
    {
      code: "NSW_INDEPENDENT_REVIEW_REQUIRED",
      detail: "A named Creditex reviewer who is not the schema author must approve this exact content hash before field publication.",
    },
    {
      code: "NSW_PROVIDER_SUBMISSION_SCHEMA_EXTERNAL",
      detail: "The current authenticated TESSA or authorised provider submission schema and provider receipt contract are not present in the retained public source set.",
    },
  ];
  if (definitions.length === 0) {
    blockers.push({
      code: "NSW_EXECUTABLE_CALCULATOR_CONTRACT_MISSING",
      detail: "No existing typed NSW estimator contract is available for this Rule activity; the work-pack form is source-transcribed but certificate quantity execution remains blocked.",
    });
  } else {
    blockers.push({
      code: "NSW_CALCULATOR_GOLDEN_VECTOR_REVIEW_REQUIRED",
      detail: "The existing typed estimator contract needs independently reviewed exact-source golden vectors before certificate execution.",
    });
  }
  if (registryRequirements.length > 0) {
    blockers.push({
      code: "NSW_IMPLEMENTATION_DATE_PRODUCT_SNAPSHOT_REQUIRED",
      detail: "The exact implementation-date product status, restrictions and registry-source hash must be resolved for the selected product.",
    });
  }
  if (candidate.registryActivityCode === "C1" || candidate.registryActivityCode === "C2") {
    blockers.push({
      code: "NSW_REMOVAL_ACTIVITY_RECORD_GUIDE_NOT_RETAINED",
      detail: "The Rule supplies exact eligibility and deemed savings, but the retained current source set has no activity-specific C1/C2 minimum-record guide.",
    });
  }
  if (candidate.registryActivityCode === "BESS2") {
    blockers.push({
      code: "NSW_BESS2_NOMINATION_SPECIFICATION_NOT_RETAINED",
      detail: "The exact BESS2 Nomination Specification required by Nomination Form v1.1 and PDRS Method Guide v3.0 is not in the retained source set.",
    });
  }

  return {
    schema: CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_SCHEMA,
    programCode: candidate.programCode,
    templateId: candidate.templateId,
    activityCode: candidate.registryActivityCode,
    title: candidate.title,
    catalogueState: candidate.catalogueState,
    effectiveRuleDate: "2026-07-01",
    method: policy.method,
    contentState: "source_transcribed_review_pending" as const,
    complianceReviewPublishable: true as const,
    fieldWorkflowContentState: completeRetainedOfficialFieldForms
      ? "source_backed_form_review_candidate" as const
      : "source_only_contract_not_publishable" as const,
    completeRetainedOfficialFieldForms,
    tradeWorkflowReady: false as const,
    fieldPublished: false as const,
    activationReady: false as const,
    sources: sourceDocuments,
    formSections: [
      {
        sectionKey: "job-and-nomination",
        title: "Customer, site and nomination",
        fields: commonFormFields(candidate.programCode),
      },
      {
        sectionKey: "activity-evidence",
        title: "Activity evidence",
        fields: policy.evidence.map((item) => ({
          key: item.key,
          label: item.label,
          inputType: item.captureKind,
          required: item.required,
          prefillFrom: item.captureKind === "registry_snapshot"
            ? "governed_registry"
            : item.captureKind === "calculation_receipt"
              ? "governed_calculator"
              : "operator",
          source: evidenceSource,
        })),
      },
      ...definitions.map((definition) => ({
        sectionKey: `calculation-${definition.activityCode.toLowerCase()}`,
        title: definition.title,
        fields: definition.inputDefinitions.map((input) => ({
          key: `${definition.activityCode}:${input.key}`,
          label: input.label,
          inputType: input.type,
          unit: input.unit,
          required: true as const,
          prefillFrom: input.key.includes("registry")
            ? "governed_registry" as const
            : "operator" as const,
          source: formulaSource(candidate.programCode, definition),
        })),
      })),
    ],
    evidenceRequirements: policy.evidence.map((item) => ({
      ...item,
      source: evidenceSource,
    })),
    productContract: {
      state: definitions.length > 0
        ? "existing_typed_contract_review_pending" as const
        : "missing_existing_typed_contract" as const,
      productKinds: productValues,
      registryRequirements,
      source: definitions[0]
        ? formulaSource(candidate.programCode, definitions[0])
        : source(
            candidate.programCode === "NSW-ESS" ? "essRule" : "pdrsRule",
            `${candidate.programCode} ${candidate.registryActivityCode} exact product decision still requires typed contract authoring.`,
          ),
    },
    scenarioContract: {
      state: definitions.length > 0
        ? "existing_typed_contract_review_pending" as const
        : "missing_existing_typed_contract" as const,
      values: scenarioValues,
      source: definitions[0]
        ? formulaSource(candidate.programCode, definitions[0])
        : source(
            candidate.programCode === "NSW-ESS" ? "essRule" : "pdrsRule",
            `${candidate.programCode} ${candidate.registryActivityCode} exact scenario decision still requires typed contract authoring.`,
          ),
    },
    calculatorContracts: definitions.map((definition) => ({
      activityCode: definition.activityCode,
      formulaKey: definition.formulaKey,
      outputUnit: definition.outputUnit,
      calculationStatus: definition.calculationStatus,
      inputKeys: definition.inputDefinitions.map((input) => input.key),
      source: formulaSource(candidate.programCode, definition),
    })),
    signatures: policy.signerRoles.map((role) => ({
      signatureId: `${candidate.templateId}:${role}`,
      role,
      visibleSignatureBox: true as const,
      placement: role === "site_assessor"
        ? "site-assessor-declaration.signature"
        : role === "purchaser"
          ? "post-implementation-declaration.purchaser-signature"
          : role === "installer_or_supervising_qualified_licence_holder"
            ? "post-implementation-or-installer-declaration.installer-signature"
            : role === "original_energy_saver_or_capacity_holder" && candidate.registryActivityCode === "BESS2"
              ? "bess2-nomination-specification.capacity-holder-signature"
              : role === "owner" && candidate.registryActivityCode === "BESS2"
                ? "bess2-owner-declaration.signature"
                : "nomination-form.capacity-holder-signature",
      source: role === "site_assessor"
        ? source("siteAssessorDeclaration", "Site Assessor Declaration v2.2 signature table.")
        : role === "purchaser"
          ? source("postImplementationDeclaration", "Post Implementation Declaration v2.2 purchaser signature table.")
          : role === "original_energy_saver_or_capacity_holder" && candidate.registryActivityCode === "BESS2"
            ? source(
                "pdrsMethodGuide",
                "PDRS Method Guide v3.0, Table B.11 requires the BESS2 Nomination Specification; the exact specification remains a publication blocker.",
              )
            : role === "original_energy_saver_or_capacity_holder"
              ? source("nominationForm", "Nomination Form v1.1 Section 5 signature table.")
              : evidenceSource,
    })),
    documentOutputs: declarationDocuments(
      candidate.programCode,
      candidate.registryActivityCode,
      policy,
    ),
    blockers,
  };
}

export const CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT =
  CREDITEX_NSW_CERTIFICATE_WORK_PACK_CONTENT_CANDIDATES.map(
    createGovernedCandidate,
  );

export type CreditexNswGovernedWorkPackContent =
  (typeof CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT)[number];

export function validateCreditexNswGovernedWorkPackContent(
  content: readonly CreditexNswGovernedWorkPackContent[] =
    CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT,
) {
  const errors: string[] = [];
  if (content.length !== 48) {
    errors.push(`Expected 48 NSW governed work-pack schemas, received ${content.length}.`);
  }
  if (new Set(content.map((item) => item.templateId)).size !== content.length) {
    errors.push("NSW governed work-pack template IDs must be unique.");
  }
  for (const item of content) {
    const prefix = `${item.programCode} ${item.activityCode}`;
    if (item.contentState !== "source_transcribed_review_pending") {
      errors.push(`${prefix} is not a source-transcribed review candidate.`);
    }
    if (!item.complianceReviewPublishable || item.tradeWorkflowReady || item.fieldPublished || item.activationReady) {
      errors.push(`${prefix} has an invalid review or publication state.`);
    }
    if (
      item.completeRetainedOfficialFieldForms !==
        (item.fieldWorkflowContentState === "source_backed_form_review_candidate")
    ) {
      errors.push(`${prefix} has an invalid field-workflow completeness state.`);
    }
    if (item.sources.length < 2 || item.sources.some((itemSource) =>
      !itemSource.expectedSha256 || !itemSource.citation
    )) {
      errors.push(`${prefix} has an incomplete exact-source binding.`);
    }
    if (item.formSections.length < 2 || item.formSections.some((section) => section.fields.length === 0)) {
      errors.push(`${prefix} has an incomplete guided form.`);
    }
    if (item.evidenceRequirements.length === 0 || item.documentOutputs.length === 0) {
      errors.push(`${prefix} has incomplete evidence or document outputs.`);
    }
    if (item.signatures.length === 0 || item.signatures.some((signature) =>
      !signature.visibleSignatureBox || !signature.placement
    )) {
      errors.push(`${prefix} has an incomplete visible-signature mapping.`);
    }
    if (!item.blockers.some((blocker) => blocker.code === "NSW_INDEPENDENT_REVIEW_REQUIRED")) {
      errors.push(`${prefix} does not preserve independent review.`);
    }
    if (!item.blockers.some((blocker) => blocker.code === "NSW_PROVIDER_SUBMISSION_SCHEMA_EXTERNAL")) {
      errors.push(`${prefix} does not preserve the external submission boundary.`);
    }
    if (item.calculatorContracts.length === 0 && !item.blockers.some(
      (blocker) => blocker.code === "NSW_EXECUTABLE_CALCULATOR_CONTRACT_MISSING",
    )) {
      errors.push(`${prefix} hides a missing calculator contract.`);
    }
    if (item.calculatorContracts.length > 0 && item.productContract.productKinds.length === 0) {
      errors.push(`${prefix} has a calculator without a product contract.`);
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    total: content.length,
    sourceTranscribedReviewCandidates: content.filter(
      (item) => item.complianceReviewPublishable,
    ).length,
    sourceBackedFormReviewCandidates: content.filter(
      (item) => item.completeRetainedOfficialFieldForms,
    ).length,
    sourceOnlyContracts: content.filter(
      (item) => !item.completeRetainedOfficialFieldForms,
    ).length,
    tradeWorkflowReady: content.filter((item) => item.tradeWorkflowReady).length,
    executableEstimatorCandidates: content.filter(
      (item) => item.calculatorContracts.length > 0,
    ).length,
    fieldPublished: content.filter((item) => item.fieldPublished).length,
    activationReady: content.filter((item) => item.activationReady).length,
  };
}

export const CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION =
  validateCreditexNswGovernedWorkPackContent();

if (!CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION.valid) {
  throw new Error(
    `Invalid Creditex NSW governed work-pack content: ${CREDITEX_NSW_GOVERNED_WORK_PACK_CONTENT_VALIDATION.errors.join(" ")}`,
  );
}
