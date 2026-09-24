import { analyseCreditexCsv } from "./creditex-interchange-preflight.ts";
import schemaSource from "../../docs/compliance/registry-contracts/schemas.json" with { type: "json" };

export type RegistryFormatKey = "rec_sgu" | "rec_swh" | "rec_battery" | "nsw_esc" | "nsw_prc";
export type RegistryRow = Readonly<Record<string, string>>;
export type RegistryFieldDescriptor = Readonly<{
  name: string;
  dataType: string;
  mandatory: string;
  validation: string;
  business: string;
  reference: string;
  sourceLocation: string;
}>;
type Source = Readonly<{ file: string; url: string; sha256: string; retrievedAt: string; bytes: number }>;
export type RegistryFormatDescriptor = Readonly<{
  key: RegistryFormatKey;
  label: string;
  scheme: "SRES" | "ESS" | "PDRS";
  version: string;
  headers: readonly string[];
  fields: readonly RegistryFieldDescriptor[];
  sources: readonly Source[];
  maximumRecords: number;
  referenceField: "Reference" | "ACP Implementation Identifier";
  certificateQuantityField: null;
  batchContextRequired: readonly string[];
  serializerAvailable: true;
  externalSubmissionEnabled: false;
  complianceEligibilityAssessed: false;
  remainingReviewRequirements: readonly string[];
}>;
export type RegistryValidationIssue = Readonly<{
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
}>;
export type RegistryValidationResult = Readonly<{
  valid: boolean;
  issues: readonly RegistryValidationIssue[];
  complianceEligibilityAssessed: false;
  validationScope: "retained_file_schema_and_documented_fields";
  remainingReviewRequirements: readonly string[];
}>;
export type RegistrySerializationResult = RegistryValidationResult & Readonly<{
  csv: string | null;
  sha256: string | null;
}>;

const KEYS: readonly RegistryFormatKey[] = ["rec_sgu", "rec_swh", "rec_battery", "nsw_esc", "nsw_prc"];
const LABELS: Record<RegistryFormatKey, string> = {
  rec_sgu: "REC Registry small generation units",
  rec_swh: "REC Registry solar water heaters and air source heat pumps",
  rec_battery: "REC Registry solar batteries",
  nsw_esc: "TESSA energy savings certificates",
  nsw_prc: "TESSA peak reduction certificates",
};
const REVIEW = Object.freeze([
  "Independent compliance approval, evidence, rights assignment and governed certificate calculation remain required.",
  "Verify product approval, installer accreditation, ABR entity matching and address reference data against authoritative records for the installation date.",
  "Verify current rules, effective dates, submission deadlines and account permissions. A valid CSV is not statutory eligibility or registry acceptance.",
  "Verify attachments, signed data packages and any existing or failed registry references with the registry.",
]);
const SCHEMAS: Record<RegistryFormatKey, { fields: RegistryFieldDescriptor[]; sources: Source[]; version: string }> = schemaSource;
const FORMATS: readonly RegistryFormatDescriptor[] = Object.freeze(KEYS.map((key) => {
  const source = SCHEMAS[key];
  const nsw = key.startsWith("nsw_");
  return Object.freeze({
    key, label: LABELS[key], scheme: key === "nsw_esc" ? "ESS" : key === "nsw_prc" ? "PDRS" : "SRES",
    version: source.version,
    headers: Object.freeze(source.fields.map((field) => field.name)),
    fields: Object.freeze(source.fields.map((field) => Object.freeze({ ...field }))),
    sources: Object.freeze(source.sources.map((item) => Object.freeze({ ...item }))),
    maximumRecords: nsw ? 3000 : 250,
    referenceField: nsw ? "ACP Implementation Identifier" : "Reference",
    certificateQuantityField: null,
    batchContextRequired: Object.freeze(nsw ? ["accreditationId", "baseVintage"] : ["recAccountId"]),
    serializerAvailable: true,
    externalSubmissionEnabled: false,
    complianceEligibilityAssessed: false,
    remainingReviewRequirements: REVIEW,
  } satisfies RegistryFormatDescriptor);
}));

export function listRegistryFormats(): readonly RegistryFormatDescriptor[] { return FORMATS; }

function descriptor(key: RegistryFormatKey) {
  const found = FORMATS.find((format) => format.key === key);
  if (!found) throw new TypeError("Unknown registry format.");
  return found;
}

const YES_NO = ["Yes", "Y", "No", "N"];
const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const yes = (value: string | undefined) => value === "Yes" || value === "Y";
const no = (value: string | undefined) => value === "No" || value === "N";
const present = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;
const NSW_START = "Deemed Energy Savings Method - ";
const PIAMV = "Project Impact Assessment with Measurement and Verification Method";

// No system clock or network access: deadline and effective-date approval belongs
// to the governed claim review. Dates here are Gregorian calendar/format checks.
function dateValue(value: string): number | null {
  const match = /^(\d{1,2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1] ? year * 10000 + month * 100 + day : null;
}

function enumValues(key: RegistryFormatKey, field: RegistryFieldDescriptor): readonly string[] | null {
  const name = field.name, notes = field.validation;
  if (key.startsWith("nsw_")) {
    if (name === "State") return ["NSW"];
    if (["Multi split system", "Was an Inverter installed", "Is a Solar PV system connected?"].includes(name)) return ["Yes", "No"];
    if (name === "New or Replacement") return ["New", "Replacement"];
    if (name.startsWith("Product class of")) return Array.from({ length: key === "nsw_esc" ? 4 : 15 }, (_, index) => String(index + (key === "nsw_esc" ? 12 : 1)));
    // Lists are transcribed from the unwrapped source workbook, not guessed from
    // the example rows. See the preserved multiline source below.
    const raw = NSW_ENUMS[name];
    return raw ?? null;
  }
  if (/Y\/Yes or N\/No/.test(notes) || field.reference === "Yes or No" || field.business === "Yes or No") return YES_NO;
  if (/ state$/i.test(name)) return STATES;
  if (/address type$/i.test(name)) return ["Physical", "Postal"];
  if (name === "Owner type") return ["Individual", "Corporate body", "Government body", "Trustee"];
  if (name === "Installation property type") return ["Residential", "School", "Commercial"];
  if (name === "Single or multi-story" || name === "Installation single or multi story") return ["Single story", "Multi story"];
  if (name === "System mounting type") return ["Building or structure", "Ground mounted or free standing"];
  if (name === "Installation Type") return ["New system", "Replacement system", "Extension system", "Additional system"];
  if (name === "Installation type") return ["New building", "Replaced electric heater", "Replaced solar water heater", "First solar water heater at existing building", "Replace gas water heater", "Other"];
  if (name === "Type of system" && key === "rec_battery") return ["S.G.U. - solar battery (deemed)"];
  if (name === "Type of system") return ["S.G.U. – Solar (deemed)", "S.G.U. – Wind (deemed)", "S.G.U. – Hydro (deemed)"];
  if (name === "Type of connection to the electricity grid") return key === "rec_sgu"
    ? ["Connected to an electricity grid without battery storage", "Connected to an electricity grid", "Stand-alone (not connected to an electricity grid)"]
    : ["Connected to an electricity grid", "Stand-alone (not connected to an electricity grid)"];
  if (name === "Location of solar battery") return ["Indoor", "Outdoor"];
  if (name === "Is the system retrospectively connected to an existing solar PV system or commissioned at the same time as a new solar PV system?") return ["Connected to existing PV", "Installed with new solar installation"];
  if (key === "rec_sgu" && name === "Was a solar retailer involved in the procurement and installation of the system?") return YES_NO;
  if (key === "rec_swh" && ["Statutory declarations sent", "Creating certificates for previously failed SWH"].includes(name)) return YES_NO;
  return null;
}

const BUSINESS_CLASSES = ["A Agriculture, Forestry and Fishing", "B Mining", "C Manufacturing", "D Electricity, Gas, Water and Waste Services", "E Construction", "F Wholesale Trade", "G Retail Trade", "H Accommodation and Food Services", "I Transport, Postal and Warehousing", "J Information Media and Telecommunications", "K Financial and Insurance Services", "L Rental, Hiring and Real Estate Services", "M Professional, Scientific and Technical Services", "N Administrative and Support Services", "O Public Administration and Safety", "P Education and Training", "Q Health Care and Social Assistance", "R Arts and Recreation Services", "S Other Services", "Residential", "Unknown"];
const SERVICES = ["Air compression", "Air handling, fans, ventilation", "Air heating and cooling", "Cleaning, washing", "Communications", "Computers, office equipment", "Cooking", "Electricity supply", "Home entertainment", "Lighting", "Materials handling, conveying", "Milling, mixing, grinding", "People movement, lifts, escalators", "Process drives", "Process heat", "Refrigeration and freezing", "Transport", "Water heating", "Water/liquid pumping", "Other machines"];
const NSW_ENUMS: Readonly<Record<string, readonly string[]>> = {
  "End-User Business Classification": BUSINESS_CLASSES,
  "End-Use Service": [...SERVICES, ...SERVICES.map((service) => `Making available ${service} at a leased premises`)],
  "Calculation Method": ["High Efficiency Motor Energy Savings Formula", "Home Energy Efficiency Retrofits", "Installation of High Efficiency Appliances for Businesses", "Power Factor Correction Energy Savings Formula", "Public Lighting Energy Savings Formula", "Removal of Old Appliances"].map((method) => NSW_START + method).concat(["Metered Baseline Method - Aggregated Metered Baseline", "Metered Baseline Method - Baseline per unit of output", "Metered Baseline Method - Baseline unaffected by output", "Metered Baseline Method - NABERS Baseline", "Metered Baseline Method - Normalised baseline", "Project Impact Assessment Method", PIAMV]),
  "PDRS Calculation Method": ["Peak Demand Savings Capacity - Reducing Demand Using Efficiency Activity", "Peak Demand Shifting Capacity - Store and Shift Capacity", "Peak Demand Response Capacity - Household Annual Demand Response", "Peak Demand Savings Capacity - Measured Peak Demand Savings"],
  "PDRS Activity Definition": ["HVAC1", "HVAC2", "RF2 - Classes 1 - 6, 9, 10", "RF2 - Classes 7, 8 and 11 (<3.3)", "RF2 - Classes 7, 8 and 11 (>=3.3)", "RF2 - Classes 12 - 15", "SYS2", "BESS1", "BESS2", "BESS3", "BESS4", "BESS5"],
  "Exempt Energy Program or Government site": ["HESP", "Government site"],
};

function requiredField(key: RegistryFormatKey, field: RegistryFieldDescriptor, row: RegistryRow): boolean {
  const name = field.name;
  if (key.startsWith("nsw_")) {
    if (name === "National Metering Identifier (NMI)") return (dateValue(row["Implementation Date"] ?? "") ?? 0) >= 20241101;
    return field.mandatory === "Yes";
  }
  // Postal and special physical addresses have a different required field set.
  const prefix = /^(Owner|Installer|Electrician|Designer) /.exec(name)?.[1];
  if (prefix && / (street name|street type|street number)$/i.test(name) && row[`${prefix} address type`] === "Postal") return false;
  if (prefix && / (state|postcode)$/i.test(name) && prefix === "Owner" && present(row["Owner country"]) && row["Owner country"] !== "Australia") return false;
  const special = key === "rec_swh" ? row["Installation special address"] : row["If the address entered above does not adequately describe the location of the system please provide further detailed information for the Clean Energy Regulator to locate the system"];
  if (/^Installation street (name|type|number)$/.test(name) && present(special)) return false;
  if (key === "rec_sgu" && row["Signed data package"] && field.business.includes("must be left blank if a signed data package")) return false;
  if (key === "rec_sgu" && field.business === "*Mandatory") return true;
  return field.mandatory === "Yes";
}

function validateFields(key: RegistryFormatKey, row: RegistryRow, report: (code: string, field: string, message: string) => void) {
  for (const field of descriptor(key).fields) {
    const name = field.name, value = row[name] ?? "";
    if (requiredField(key, field, row) && !present(value)) report("REQUIRED_FIELD", name, "The official field is required.");
    if (!present(value)) continue;
    if (/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFF]|[\uD800-\uDFFF]/u.test(value) || value.includes("\uFEFF")) report("INVALID_CHARACTER", name, "Control characters, unpaired surrogates and embedded byte order marks are not accepted.");
    const values = enumValues(key, field);
    if (values && !values.includes(value)) report("REFERENCE_VALUE", name, `Use one of the retained official values: ${values.join(", ")}.`);
    if (field.dataType === "Date" && dateValue(value) === null) report("DATE_FORMAT", name, "Use a valid calendar date in DD/MM/YYYY format.");
    const max = /Text\s*\(([\d,]+)\)/i.exec(field.dataType);
    if (max && value.length > Number(max[1].replaceAll(",", ""))) report("TEXT_LENGTH", name, `Maximum ${max[1]} characters.`);
    const serial = /serial number/i.test(name);
    if (/^(Int|Integer)$/i.test(field.dataType) && !serial && !/^\d+$/.test(value)) report("INTEGER_FORMAT", name, "Use a non-negative whole number.");
    if (/^(Number|Currency|Float|Decimal)/.test(field.dataType) && (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) report("NUMBER_FORMAT", name, "Use a finite decimal number without separators or an exponent.");
    const decimals = /Decimal\s*\((\d+),(\d+)\)/.exec(field.dataType);
    if (decimals && /^-?\d+(?:\.\d+)?$/.test(value)) {
      const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
      // The SWH PDF prints Decimal(3,9) for coordinates. The related SGU
      // definition is Decimal(12,9); enforce the unambiguous nine-place limit.
      if (fraction.length > Number(decimals[2]) || (Number(decimals[1]) >= Number(decimals[2]) && whole.length + fraction.length > Number(decimals[1]))) report("DECIMAL_PRECISION", name, `Value exceeds the documented precision ${field.dataType}.`);
    }
    if (field.validation.includes("Must be specified to 2 decimal places") && !/^-?\d+\.\d{2}$/.test(value)) report("DECIMAL_PLACES", name, "Exactly two decimal places are required.");
    if (field.validation.includes("up to 2 decimal places") && !/^-?\d+(?:\.\d{1,2})?$/.test(value)) report("DECIMAL_PLACES", name, "Use at most two decimal places.");
    if (/email/i.test(name) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) report("EMAIL_FORMAT", name, "Enter a valid email address.");
    if (/ (phone|fax|mobile)$/i.test(name) && !/^\+?\d{6,16}$/.test(value)) report("PHONE_FORMAT", name, "Use 6 to 16 digits with an optional leading plus.");
    if (/ABN$/.test(name) && !/^\d+$/.test(value)) report("ABN_FORMAT", name, "ABN values must contain digits only; legal entity matching still requires an ABR check.");
    if (name === "Postcode" && !/^\d{4}$/.test(value)) report("POSTCODE_FORMAT", name, "Use exactly four digits.");
    if (/postcode$/i.test(name) && key.startsWith("rec_") && !(name === "Owner postcode" && row["Owner country"] && row["Owner country"] !== "Australia") && !/^\d{4}$/.test(value)) report("POSTCODE_FORMAT", name, "Australian postcodes contain four digits.");
    if (key.startsWith("nsw_") && /licence$/.test(name) && !/^[A-Za-z0-9]+$/.test(value)) report("LICENCE_FORMAT", name, "Licence values cannot contain punctuation or decimal points.");
    if (key.startsWith("nsw_") && name === "Suburb" && /[0-9!@#$%^&*()_+\-=:\"{}|\\\][<>?/.,]/.test(value)) report("SUBURB_FORMAT", name, "The TESSA suburb field cannot contain digits or the prohibited punctuation.");
    if (/latitude/i.test(name) && (Number(value) < -90 || Number(value) > 90)) report("COORDINATE_RANGE", name, "Latitude must be between -90 and 90.");
    if (/longitude/i.test(name) && (Number(value) < -180 || Number(value) > 180)) report("COORDINATE_RANGE", name, "Longitude must be between -180 and 180.");
    if (/Min length of string is 7/.test(field.validation) && value.length < 7) report("TEXT_LENGTH", name, "At least seven characters are required.");
    if (key === "rec_sgu" && row["Signed data package"] && field.business.includes("must be left blank if a signed data package")) report("MUST_BE_BLANK", name, "This field must be blank when using a signed data package.");
  }
}

function validateRec(key: RegistryFormatKey, row: RegistryRow, report: (code: string, field: string, message: string) => void) {
  const require = (...names: string[]) => names.forEach((name) => { if (!present(row[name])) report("CONDITIONAL_FIELD", name, "This field is required by the selected answers."); });
  const serials = (name: string, count?: string) => {
    if (!present(row[name])) return;
    const values = row[name].split(";");
    if (values.length > 1000 || values.some((v) => !v.trim() || v.length > 100) || new Set(values).size !== values.length) report("SERIAL_NUMBERS", name, "Provide 1 to 1000 unique semicolon-separated serial numbers, each up to 100 characters.");
    if (count && present(row[count]) && Number(row[count]) !== values.length) report("SERIAL_COUNT", name, `Serial count must match ${count}.`);
  };
  for (const field of descriptor(key).fields) {
    if (/^(Number of (panels|inverters|solar batteries))$/.test(field.name) && present(row[field.name])) {
      const min = key === "rec_swh" && field.name === "Number of panels" ? 0 : 1;
      if (Number(row[field.name]) < min || Number(row[field.name]) > 1000) report("COUNT_RANGE", field.name, `Value must be between ${min} and 1000.`);
    }
  }
  for (const prefix of ["Owner", "Installer", "Electrician", "Designer"]) {
    if (row[`${prefix} address type`] === "Postal") require(`${prefix} postal delivery type`, `${prefix} postal delivery number`);
    if (present(row[`${prefix} unit type`]) !== present(row[`${prefix} unit number`])) require(`${prefix} unit type`, `${prefix} unit number`);
  }
  if (present(row["Installation unit type"]) !== present(row["Installation unit number"])) require("Installation unit type", "Installation unit number");
  if (key === "rec_swh") {
    serials("Tank serial numbers (s)");
    if (yes(row["Is the volumetric capacity of this installation greater than 700L"])) {
      require("Statutory declarations sent");
      if (!yes(row["Statutory declarations sent"])) report("DECLARATION_REQUIRED", "Statutory declarations sent", "The source requires Yes for installations greater than 700L.");
    }
    if (yes(row["Creating certificates for previously failed SWH"])) require("Failed accreditation code", "Explanatory notes for failed accreditation code");
    if (yes(row["Is there more than one SWH/ASHP at this address?"])) require("Additional system information");
    return;
  }
  const retailer = key === "rec_battery" ? "Was a solar battery retailer involved in the procurement and installation of the system?" : "Was a solar retailer involved in the procurement and installation of the system?";
  if (yes(row[retailer])) {
    require("Retailer representative", "Retailer role");
    if (!(key === "rec_sgu" && row["Signed data package"])) {
      require("Retailer name");
      if (row["Retailer name"] !== "owner") require("Retailer ABN");
    }
    if (key === "rec_sgu" && row["Type of system"]?.includes("Solar")) descriptor(key).fields.filter((f) => /^Retailer .*statement/.test(f.name)).forEach((f) => require(f.name));
  }
  if (row["Retailer name"] === "owner" && present(row["Retailer ABN"])) report("MUST_BE_BLANK", "Retailer ABN", "Retailer ABN must be blank when Retailer name is owner.");
  if (row["Owner type"] === "Individual") {
    require(key === "rec_sgu" ? "Owner First Name" : "Owner first name", key === "rec_sgu" ? "Owner Surname" : "Owner surname");
  } else if (present(row["Owner type"])) require("Owner organisation name");
  serials("Inverter serial number(s)", "Number of inverters");
  if (key === "rec_battery") {
    if (yes(row["Are inverters being added as part of the solar battery system?"])) require("Inverter manufacturer", "Inverter series", "Inverter model number", "Number of inverters", "Inverter serial number(s)");
    serials("Solar battery serial number(s)", "Number of solar batteries");
    if (yes(row["Are you adding battery capacity to an existing battery stack?"])) require("What is the nominal power output (kWh) of your existing solar battery system?", "What is the usable power output (kWh) of your existing solar battery system?");
    const nominal = "What is the nominal power output (kWh) of your solar battery system?", usable = "What is the usable power output (kWh) of your solar battery system?";
    if (present(row[nominal]) && (Number(row[nominal]) < 5 || Number(row[nominal]) > 100)) report("CAPACITY_RANGE", nominal, "Nominal capacity must be between 5 and 100 kWh.");
    if (present(row[usable]) && (Number(row[usable]) < 0.001 || Number(row[usable]) > 100)) report("CAPACITY_RANGE", usable, "Usable capacity must be between 0.001 and 100 kWh.");
    if (yes(row["Are you creating certificates for a solar battery system that has previously been failed by the Clean Energy Regulator?"])) require("Failed accreditation code");
    if (present(row["National Metering Identifier (NMI)"]) && !/^.{10,11}$/.test(row["National Metering Identifier (NMI)"])) report("NMI_FORMAT", "National Metering Identifier (NMI)", "Use 10 or 11 characters.");
  } else {
    const solar = row["Type of system"]?.includes("Solar");
    if (solar) { require("System mounting type"); if (!row["Signed data package"]) require("Number of panels"); }
    else {
      require("Is a site specific audit report available?", "Do you wish to use the default resource availability figure?");
      if (no(row["Do you wish to use the default resource availability figure?"])) require("What is your resource availability (hours per annum) for your system?");
    }
    serials("Equipment model serial number(s)", solar ? "Number of panels" : undefined);
    const capacity = "What is the rated power output (in kW) of your small generation unit";
    const max = solar ? 100 : row["Type of system"]?.includes("Wind") ? 10 : 6.4;
    if (present(row[capacity]) && (Number(row[capacity]) <= 0 || Number(row[capacity]) > max)) report("CAPACITY_RANGE", capacity, `Rated capacity must be greater than zero and at most ${max} kW.`);
    if (yes(row["Are you creating certificates for a system that has previously been failed by the Clean Energy Regulator?"])) require("Accreditation code", "Explanatory notes for re-creating certificates previously failed");
    if (no(row["Are you installing a complete unit (adding capacity to an existing system is not considered a complete unit)?"])) require(descriptor(key).headers[12]);
    if (yes(row["Is there more than one SGU at this address?"])) require(descriptor(key).headers[57]);
    if (["Extension system", "Additional system"].includes(row["Installation Type"])) require("Installation Type Additional Information");
    if (row["Type of connection to the electricity grid"]?.startsWith("Stand-alone") && !yes(row["Not grid-connected statement"])) report("DECLARATION_REQUIRED", "Not grid-connected statement", "A stand-alone system requires this statement to be Yes.");
  }
}

function validateNsw(key: RegistryFormatKey, row: RegistryRow, report: (code: string, field: string, message: string) => void) {
  const require = (...names: string[]) => names.forEach((name) => { if (!present(row[name])) report("CONDITIONAL_FIELD", name, "This field is required for the selected activity or method."); });
  const activity = row[key === "nsw_esc" ? "ESS Activity Definition" : "PDRS Activity Definition"] ?? "";
  const method = row[key === "nsw_esc" ? "Calculation Method" : "PDRS Calculation Method"] ?? "";
  const date = dateValue(row["Implementation Date"] ?? "") ?? 0;
  const abn = key === "nsw_esc" ? "End User ABN" : "ABN";
  if (present(row["End-User Business Classification"]) && !["Residential", "Unknown"].includes(row["End-User Business Classification"])) require(abn);
  if (key === "nsw_esc") {
    const publicLighting = method === NSW_START + "Public Lighting Energy Savings Formula";
    if (!publicLighting) require("Address Line 2 ( Street No , Street Name )");
    if (publicLighting) for (const name of ["Address Line 1 ( Unit / Shop / Level , Unit Type )", "Address Line 2 ( Street No , Street Name )"]) if (present(row[name])) report("MUST_BE_BLANK", name, "Public lighting requires this address field to be blank.");
    const savings = descriptor(key).headers.filter((name) => name.endsWith("Savings (MWh)"));
    const populated = savings.filter((name) => present(row[name]));
    if (!populated.length) report("SAVINGS_REQUIRED", "Electricity Savings (MWh)", "At least one savings field must be populated.");
    if (populated.length >= 2) require("Estimated % of each of these savings attributed to fuel switching");
    if ((row["Estimated % of each of these savings attributed to fuel switching"] ?? "").length > 200) report("TEXT_LENGTH", "Estimated % of each of these savings attributed to fuel switching", "Maximum 200 characters.");
    if (method.startsWith("Metered Baseline Method") || ["Project Impact Assessment Method", PIAMV].includes(method)) require("Measurement Date");
    if (method === NSW_START + "High Efficiency Motor Energy Savings Formula" && Number(row["Purchase Cost (Excluding GST)"]) <= 30) report("PURCHASE_COST", "Purchase Cost (Excluding GST)", "This method requires purchase cost greater than 30.00.");
    if (date >= 20241101) {
      if (["D19", "D20", "E6", "F17"].includes(activity)) require("Plumbing licence");
      if (["D14", "D15", "D16", "D17", "D18", "D19", "D20", "E1", "E2", "E3", "E4", "E5", "E11", "E12", "E13", "F4", "F17"].includes(activity)) require("Electrician licence");
      if (activity === "F4") require("Refrigerant handling licence");
    }
    if (activity === "D16" && date >= 20260701) require("Multi split system");
    const mvFields = descriptor(key).headers.slice(40, 50);
    if (method !== PIAMV) for (const field of mvFields) if (present(row[field])) report("METHOD_FIELD", field, "This field is only permitted for the measurement and verification method.");
    const start = dateValue(row["Baseline measurement period start date"] ?? ""), end = dateValue(row["Baseline measurement period end date"] ?? "");
    if (start !== null && end !== null && start >= end) report("DATE_ORDER", "Baseline measurement period end date", "Baseline end must follow baseline start.");
    if (present(row["Operating measuring period start date"]) && present(row["Operating measuring period end date"])) report("SOURCE_CONTRACT_CONFLICT", "Operating measuring period start date", "TESSA v1.7 requires both operating start > end and end > start. Obtain a corrected authoritative contract before exporting this date pair.");
  } else {
    if (present(row["National Metering Identifier (NMI)"]) && !/^[A-Za-z0-9]{10,}$/.test(row["National Metering Identifier (NMI)"])) report("NMI_FORMAT", "National Metering Identifier (NMI)", "TESSA requires an alphanumeric NMI of at least 10 characters.");
    if (activity.startsWith("RF2")) {
      require("Product class of removed equipment", "Product class of installed equipment");
      if (date >= 20241101) require("Plumbing licence");
    }
    const battery = ["BESS1", "BESS3", "BESS4", "BESS5"].includes(activity);
    if ((["HVAC1", "HVAC2"].includes(activity) && date >= 20221101) || (activity === "BESS1" && date >= 20241101) || (["BESS3", "BESS4", "BESS5"].includes(activity) && date >= 20260901)) require("Electrician licence");
    if (battery) require("SAA accreditation", "Was an Inverter installed");
    if (yes(row["Was an Inverter installed"])) require("Inverter Brand", "Inverter Model Number");
    for (const field of ["Inverter Brand", "Inverter Model Number"]) if (/^\s/.test(row[field] ?? "")) report("LEADING_SPACE", field, "The official field cannot begin with a space.");
    if ((activity === "BESS1" && date >= 20260701) || (["BESS3", "BESS4", "BESS5"].includes(activity) && date >= 20260901)) {
      require("Is a Solar PV system connected?");
      if (activity === "BESS1" && row["Is a Solar PV system connected?"] !== "Yes") report("PV_REQUIRED", "Is a Solar PV system connected?", "The retained BESS1 CSV specification requires Yes.");
      if (yes(row["Is a Solar PV system connected?"])) require("Existing Inverter capacity (kW)", "Existing Solar PV capacity (kW)", "New Inverter capacity (kW)", "New Solar PV capacity (kW)", "Total Solar PV capacity (kW)", "Total Inverter capacity (kW)");
    }
    for (const label of ["Inverter", "Solar PV"]) {
      const fields = [`Existing ${label} capacity (kW)`, `New ${label} capacity (kW)`, `Total ${label} capacity (kW)`];
      if (fields.every((field) => present(row[field])) && Math.abs(Number(row[fields[0]]) + Number(row[fields[1]]) - Number(row[fields[2]])) > 0.00001) report("CAPACITY_TOTAL", fields[2], "Total capacity must equal existing plus new capacity.");
    }
    if (activity === "HVAC1" && date >= 20260701) require("Multi split system");
  }
}

export function validateRegistryRows(formatKey: RegistryFormatKey, rows: readonly RegistryRow[]): RegistryValidationResult {
  const format = descriptor(formatKey);
  const issues: RegistryValidationIssue[] = [];
  if (!Array.isArray(rows) || !rows.length) issues.push({ code: "ROWS_REQUIRED", message: "Include at least one implementation row." });
  if (rows.length > format.maximumRecords) issues.push({ code: "MAXIMUM_RECORDS", message: `This official format permits at most ${format.maximumRecords} records.` });
  const references = new Set<string>();
  const vintages = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const report = (code: string, field: string, message: string) => issues.push({ code, field, message, rowNumber: index + 2 });
    if (!row || typeof row !== "object" || Array.isArray(row)) { report("ROW_TYPE", "", "Each row must be a record of exact official field names and string values."); continue; }
    let invalidType = false;
    for (const [name, value] of Object.entries(row)) {
      if (!format.headers.includes(name)) report("UNKNOWN_FIELD", name, "This is not an exact field name in the official template.");
      if (typeof value !== "string") { invalidType = true; report("VALUE_TYPE", name, "Values must be strings; no implicit date or number conversion is performed."); }
    }
    if (invalidType) continue;
    validateFields(formatKey, row, report);
    if (formatKey.startsWith("nsw_")) {
      validateNsw(formatKey, row, report);
      const reference = row[format.referenceField];
      if (present(reference)) { if (references.has(reference)) report("DUPLICATE_IMPLEMENTATION", format.referenceField, "Implementation identifiers must be unique within a batch and accreditation."); references.add(reference); }
      if (formatKey === "nsw_esc" && row["Calculation Method"]?.startsWith(NSW_START) && dateValue(row["Implementation Date"] ?? "") !== null) vintages.add(row["Implementation Date"].slice(-4));
    } else validateRec(formatKey, row, report);
  }
  if (vintages.size > 1) issues.push({ code: "MIXED_VINTAGE", message: "Deemed ESS implementations in one file must belong to the same vintage." });
  return { valid: issues.length === 0, issues, complianceEligibilityAssessed: false, validationScope: "retained_file_schema_and_documented_fields", remainingReviewRequirements: format.remainingReviewRequirements };
}

function csvCell(value: string) { return /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }

export function serializeRegistryRows(formatKey: RegistryFormatKey, rows: readonly RegistryRow[]): RegistrySerializationResult {
  const validation = validateRegistryRows(formatKey, rows);
  if (!validation.valid) return { ...validation, csv: null, sha256: null };
  const format = descriptor(formatKey);
  const csv = [format.headers, ...rows.map((row) => format.headers.map((name) => row[name] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const analysis = analyseCreditexCsv(csv);
  if (analysis.issues.length || analysis.rows.some((row) => row.length !== format.headers.length) || analysis.rows.length !== rows.length + 1) return { ...validation, valid: false, issues: [{ code: "CSV_SERIALIZATION", message: "The generated CSV did not pass the shared structural parser." }], csv: null, sha256: null };
  return { ...validation, csv, sha256: analysis.rawSha256 };
}
