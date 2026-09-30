import {
  defaultTradeDataforceServiceCategory,
  isTradeDataforceImport,
  isTradeDataforceServiceCategory,
  type TradeDataforceServiceCategory,
} from "./trade-dataforce-import-metadata.ts";
import postcodeLocalities from "../data/postcode-localities.json" with { type: "json" };
import {
  DATAFORCE_JOB_CSV_HEADERS,
  DATAFORCE_JOB_CSV_LIMITS,
  parseDataforceJobCsv,
  validateDataforceJobCsv,
  type DataforceJobCsvHeader,
  type DataforceJobCsvRecord,
} from "./creditex-dataforce-job-csv.ts";

export const TRADE_DATAFORCE_IMPORT_LIMITS = Object.freeze({
  maximumRows: DATAFORCE_JOB_CSV_LIMITS.maximumRows,
  maximumSourceBytes: DATAFORCE_JOB_CSV_LIMITS.maximumSourceBytes,
});

export { TRADE_DATAFORCE_FIELD_MAPPINGS, isTradeDataforceImport } from "./trade-dataforce-import-metadata.ts";

export type TradeDataforceImportIssue = {
  code: string;
  level: "warning" | "error";
  message: string;
  rowNumber?: number;
  header?: DataforceJobCsvHeader;
};

export type TradeDataforceImportOptions = {
  serviceCategoryMappings?: Readonly<Record<string, TradeDataforceServiceCategory>>;
};

export type TradeDataforceImportRow = {
  rowNumber: number;
  sourceJobId: string;
  sourceAppId: string;
  serviceCategoryOverride?: TradeDataforceServiceCategory;
  record: DataforceJobCsvRecord;
  customerKey: string;
  siteKey: string;
  customer: {
    displayName: string;
    firstName: string;
    lastName: string;
    businessName: string;
    externalReference: string;
    email: string;
    phone: string;
    mobile: string;
    contactPhone: string;
  };
  site: { addressLine1: string; suburb: string; state: string; postcode: string };
  job: {
    title: string;
    serviceCategory: TradeDataforceServiceCategory;
    pipelineStage: "imported";
    workStage: "imported";
    scheduledStart: string;
    scheduledEnd: string;
  };
  worker: { sourceId: string; displayName: string };
  legacy: {
    status: string;
    subStatus: string;
    type: string;
    balanceCents: number | null;
    certificateCount: number | null;
    submission: string;
    invoiced: string;
    agent: string;
    client: string;
  };
  issues: TradeDataforceImportIssue[];
  status: "ready" | "warning" | "error";
};

export type TradeDataforceImportPlan = {
  valid: boolean;
  headers: readonly string[];
  rows: TradeDataforceImportRow[];
  issues: TradeDataforceImportIssue[];
  summary: {
    totalRows: number;
    readyRows: number;
    warningRows: number;
    errorRows: number;
    customerCount: number;
    siteCount: number;
  };
};

const localities: Readonly<Record<string, readonly { suburb: string; state: string }[]>> = postcodeLocalities;
const canonical = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const phoneKey = (value: string) => value.replace(/\D/g, "").replace(/^61(?=[23478]\d{8}$)/, "0");


function emptyRecord(): DataforceJobCsvRecord {
  return {
    "App Id": "", "Job Id": "", Status: "", SubStatus: "", Type: "", "Work Type": "",
    "Scheduled Datetime": "", Balance: "", "Certificates (VEECs)": "", Submission: "", Invoiced: "",
    "Field Worker": "", Agent: "", Client: "", Customer: "", "Company Name": "", "Ext Cust Ref": "",
    Phone: "", Mobile: "", Email: "", Address: "", Suburb: "", Postcode: "",
  };
}

function localDateTime(value: string): string | null {
  if (!value.trim()) return "";
  const match = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase()) + 1;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!month || year < 1900 || hour < 1 || hour > 12 || minute > 59) return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const hour24 = hour % 12 + (match[6].toUpperCase() === "PM" ? 12 : 0);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour24)}:${pad(minute)}`;
}

function sourceBalance(value: string) {
  if (!value.trim()) return null;
  const cleaned = value.trim().replace(/^\$\s*/, "");
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned.replaceAll(",", "")) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function projectRecord(record: DataforceJobCsvRecord, rowNumber: number, serviceCategoryOverride?: TradeDataforceServiceCategory): TradeDataforceImportRow {
  const issues: TradeDataforceImportIssue[] = [];
  const issue = (code: string, message: string, header: DataforceJobCsvHeader, level: "warning" | "error" = "warning") => {
    issues.push({ code, message, header, level, rowNumber });
  };
  const sourceJobId = record["Job Id"].trim();
  const sourceAppId = record["App Id"].trim();
  if (!sourceJobId) issue("JOB_ID_REQUIRED", "A source Job Id is required.", "Job Id", "error");
  if (!sourceAppId) issue("APP_ID_MISSING", "No source appointment ID was supplied.", "App Id");
  if (!record.Customer.trim() && !record["Company Name"].trim()) issue("CUSTOMER_NAME_REQUIRED", "A customer or company name is required.", "Customer", "error");
  const scheduled = localDateTime(record["Scheduled Datetime"]);
  if (scheduled === null) issue("SCHEDULE_INVALID", "The scheduled date and time cannot be safely converted. Check the source value.", "Scheduled Datetime", "error");
  const scheduledStart = scheduled ?? "";
  const status = canonical(record.Status);
  const subStatus = canonical(record.SubStatus);
  const workStage = "imported";
  const pipelineStage = "imported";
  if (!["audited", "completed", "assigned"].includes(status)) issue("SOURCE_STATUS_UNMAPPED", "The source status is retained for review; no completed status was inferred.", "Status");
  if (!["", "passed", "waived", "partial", "field"].includes(subStatus)) issue("SOURCE_SUBSTATUS_UNMAPPED", "The source substatus is retained and needs review.", "SubStatus");
  if (canonical(record.Type) !== "normal") issue("SOURCE_TYPE_UNMAPPED", "The source job type is retained and needs review.", "Type");
  const serviceCategory = serviceCategoryOverride ?? defaultTradeDataforceServiceCategory(record["Work Type"]);
  if (serviceCategory === "other" && serviceCategoryOverride === undefined) issue("WORK_TYPE_UNMAPPED", "The full work type is retained as the job title. Confirm its service category for this import.", "Work Type");
  if (!record["Work Type"].trim()) issue("WORK_TYPE_REQUIRED", "A work type is required for the job title.", "Work Type", "error");
  if (!["", "pending", "accepted"].includes(canonical(record.Submission))) issue("SOURCE_SUBMISSION_UNMAPPED", "The source submission status is retained and needs review.", "Submission");
  if (record.Invoiced.trim()) issue("SOURCE_INVOICE_NOT_RECONCILED", "The invoicing value is retained. This export does not contain the invoice needed to reconcile it.", "Invoiced");
  const balanceCents = sourceBalance(record.Balance);
  if (record.Balance.trim() && balanceCents === null) issue("SOURCE_BALANCE_UNPARSED", "The source balance is preserved but could not be converted to cents.", "Balance");
  const quantity = record["Certificates (VEECs)"].trim();
  const certificateCount = /^\d+$/.test(quantity) && Number.isSafeInteger(Number(quantity)) ? Number(quantity) : null;
  if (quantity && certificateCount === null) issue("SOURCE_CERTIFICATES_UNPARSED", "The source certificate quantity is preserved but is not a valid whole number.", "Certificates (VEECs)");
  const postcode = record.Postcode.trim();
  const suburb = record.Suburb.trim();
  const postcodeEntries = localities[postcode] ?? [];
  const matchingEntries = postcodeEntries.filter((entry) => canonical(entry.suburb) === canonical(suburb));
  const exactStates = new Set(matchingEntries.map((entry) => entry.state));
  const postcodeStates = new Set(postcodeEntries.map((entry) => entry.state));
  const state = exactStates.size === 1 ? [...exactStates][0] : postcodeStates.size === 1 ? [...postcodeStates][0] : "";
  if (!matchingEntries.length || exactStates.size !== 1) issue("LOCALITY_REVIEW", state
    ? "State was found from the exact postcode. The supplied suburb is retained and needs review against the current locality table."
    : "The source address is retained. State could not be determined from an exact postcode/locality match.", "Suburb");
  if (!record.Address.trim()) issue("ADDRESS_MISSING", "No street address was supplied.", "Address");
  if (!/^\d{4}$/.test(postcode)) issue("POSTCODE_INVALID", "The source postcode is retained and needs review.", "Postcode");
  const email = record.Email.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issue("EMAIL_INVALID", "The supplied email is retained and needs review before use.", "Email");
  for (const header of ["Phone", "Mobile"] as const) {
    if (record[header].trim() && !/^0[23478]\d{8}$/.test(phoneKey(record[header]))) issue("PHONE_REVIEW", "The supplied contact number is retained and needs review.", header);
  }
  const site = { addressLine1: record.Address.trim(), suburb, state, postcode };
  const siteKey = JSON.stringify([canonical(site.addressLine1), canonical(suburb), postcode]);
  const nameParts = record.Customer.trim().split(/\s+/);
  const phone = record.Phone.trim();
  const mobile = record.Mobile.trim();
  const customer = {
    displayName: record.Customer,
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" "),
    businessName: record["Company Name"].trim(),
    externalReference: record["Ext Cust Ref"].trim(),
    email, phone, mobile, contactPhone: mobile || phone,
  };
  if (!email && !phone && !mobile) issue("CONTACT_DETAILS_MISSING", "No email or phone was supplied. Matching includes the full name and service-site address.", "Email");
  const identity = [canonical(record.Customer), canonical(customer.businessName), email, phoneKey(phone), phoneKey(mobile)];
  if (!email && !phone && !mobile) identity.push(siteKey);
  const workerMatch = record["Field Worker"].trim().match(/^\[([^\]]+)\]\s*(.*)$/);
  return {
    rowNumber, sourceJobId, sourceAppId, ...(serviceCategoryOverride === undefined ? {} : { serviceCategoryOverride }),
    record, customerKey: JSON.stringify(identity), siteKey, customer, site,
    job: { title: record["Work Type"].trim(), serviceCategory, pipelineStage, workStage, scheduledStart, scheduledEnd: "" },
    worker: { sourceId: workerMatch?.[1] || "", displayName: workerMatch?.[2] ?? record["Field Worker"].trim() },
    legacy: { status: record.Status, subStatus: record.SubStatus, type: record.Type, balanceCents, certificateCount,
      submission: record.Submission, invoiced: record.Invoiced, agent: record.Agent, client: record.Client },
    issues,
    status: issues.some((item) => item.level === "error") ? "error" : issues.length ? "warning" : "ready",
  };
}

export function prepareTradeDataforceImport(source: string, options: TradeDataforceImportOptions = {}): TradeDataforceImportPlan {
  // Reuse the strict parser's byte, cell, row and CSV-quoting boundaries. This
  // importer accepts the same exact column names in any order without changing
  // the separate compliance staging contract's fixed header order.
  const validation = validateDataforceJobCsv(source);
  if (!isTradeDataforceImport(validation.headers)) {
    return {
      valid: false, headers: validation.headers, rows: [],
      issues: validation.issues.map((item) => ({ ...item, level: "error" })),
      summary: { totalRows: validation.summary.totalRows, readyRows: 0, warningRows: 0,
        errorRows: validation.summary.totalRows, customerCount: 0, siteCount: 0 },
    };
  }
  const parsed = parseDataforceJobCsv(source);
  const issues: TradeDataforceImportIssue[] = [];
  const rows: TradeDataforceImportRow[] = [];
  const serviceCategoryMappings = new Map<string, TradeDataforceServiceCategory>();
  const suppliedMappings = options?.serviceCategoryMappings;
  const workTypeColumn = parsed.headers.indexOf("Work Type");
  const sourceWorkTypes = new Set(parsed.rows.map((row) => canonical(row.values[workTypeColumn] ?? "")));
  if (suppliedMappings !== undefined) {
    const invalidMapping = () => issues.push({ code: "SERVICE_CATEGORY_MAPPING_INVALID", level: "error",
      message: "Choose a supported TLink service category for a work type present in this file. Conflicting mappings are not allowed.", header: "Work Type" });
    if (!suppliedMappings || typeof suppliedMappings !== "object" || Array.isArray(suppliedMappings)) invalidMapping();
    else for (const [sourceWorkType, category] of Object.entries(suppliedMappings)) {
      const key = canonical(sourceWorkType);
      if (!key || !sourceWorkTypes.has(key) || !isTradeDataforceServiceCategory(category)
        || (serviceCategoryMappings.has(key) && serviceCategoryMappings.get(key) !== category)) invalidMapping();
      else serviceCategoryMappings.set(key, category);
    }
  }
  if (issues.length) return {
    valid: false, headers: parsed.headers, rows: [], issues,
    summary: { totalRows: parsed.rows.length, readyRows: 0, warningRows: 0, errorRows: parsed.rows.length, customerCount: 0, siteCount: 0 },
  };
  const seenJobs = new Map<string, number>();
  const seenAppointments = new Map<string, number>();
  let malformedRows = 0;
  if (!parsed.rows.length) issues.push({ code: "CSV_NO_DATA_ROWS", level: "error", message: "The CSV must contain at least one job." });
  for (const input of parsed.rows) {
    if (input.values.length !== DATAFORCE_JOB_CSV_HEADERS.length || input.values.every((value) => !value.trim())) {
      malformedRows += 1;
      issues.push({ code: "CSV_ROW_COLUMN_COUNT", level: "error", rowNumber: input.rowNumber,
        message: "Every data row must contain the complete 23-column record and cannot be blank." });
      continue;
    }
    const record = emptyRecord();
    for (const header of DATAFORCE_JOB_CSV_HEADERS) record[header] = input.values[parsed.headers.indexOf(header)];
    const row = projectRecord(record, input.rowNumber, serviceCategoryMappings.get(canonical(record["Work Type"])));
    const jobKey = row.sourceJobId.toUpperCase();
    if (jobKey && seenJobs.has(jobKey)) row.issues.push({ code: "DUPLICATE_JOB_ID", level: "error", rowNumber: input.rowNumber, header: "Job Id",
      message: `Source Job Id duplicates row ${seenJobs.get(jobKey)}. Reconcile the source before import.` });
    else if (jobKey) seenJobs.set(jobKey, input.rowNumber);
    const appointmentKey = row.sourceAppId.toUpperCase();
    if (appointmentKey && seenAppointments.has(appointmentKey)) row.issues.push({ code: "DUPLICATE_APP_ID", level: "warning", rowNumber: input.rowNumber, header: "App Id",
      message: `Source appointment ID also appears in row ${seenAppointments.get(appointmentKey)}. Both source jobs are preserved.` });
    else if (appointmentKey) seenAppointments.set(appointmentKey, input.rowNumber);
    row.status = row.issues.some((item) => item.level === "error") ? "error" : row.issues.length ? "warning" : "ready";
    rows.push(row);
    issues.push(...row.issues);
  }
  return {
    valid: !issues.some((item) => item.level === "error"), headers: parsed.headers, rows, issues,
    summary: {
      totalRows: parsed.rows.length,
      readyRows: rows.filter((row) => row.status === "ready").length,
      warningRows: rows.filter((row) => row.status === "warning").length,
      errorRows: malformedRows + rows.filter((row) => row.status === "error").length,
      customerCount: new Set(rows.map((row) => row.customerKey)).size,
      siteCount: new Set(rows.map((row) => row.siteKey)).size,
    },
  };
}
