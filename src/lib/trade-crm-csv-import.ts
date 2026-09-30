import { parseStrictImportCsv } from "./creditex-dataforce-job-csv.ts";
import { CRM_CSV_CUSTOMER_FIELDS, CRM_CSV_JOB_FIELDS, type TradeCrmCsvMapping, type TradeCrmCsvRole } from "./trade-crm-csv-import-metadata.ts";
import { defaultTradeDataforceServiceCategory, isTradeDataforceServiceCategory, type TradeDataforceServiceCategory } from "./trade-dataforce-import-metadata.ts";
import postcodeLocalities from "../data/postcode-localities.json" with { type: "json" };

export type TradeCrmCsvFile = { id: string; fileName: string; csvText: string; role: TradeCrmCsvRole; mapping: TradeCrmCsvMapping };
export type TradeCrmCsvOptions = { sourceNamespace: string; unmatchedJobs: "block" | "use_job_contacts";
  serviceCategoryMappings?: Readonly<Record<string, TradeDataforceServiceCategory>>; excludedRows?: Readonly<Record<string, readonly number[]>> };
export type TradeCrmCsvIssue = { code: string; level: "warning" | "error"; message: string; header?: string; rowNumber?: number };
export type ImportAddress = { addressLine1: string; suburb: string; state: string; postcode: string };
export type ImportContact = { firstName: string; lastName: string; email: string; phone: string; mobile: string; roleLabel: string };
export type TradeCrmCsvImportRow = {
  rowNumber: number; sourceRowNumber: number; sourceFileId: string; entityType: "customer" | "job"; sourceId: string;
  sourceJobId: string; sourceAppId: string; record: Record<string, string>; customerKey: string; siteKey: string;
  customer: ImportContact & { displayName: string; businessName: string; externalReference: string; contactPhone: string; businessNumber: string };
  customerAddress: ImportAddress; site: ImportAddress; contacts: ImportContact[];
  billing: ImportAddress & { country: string }; paymentTerms: string; taxRate: string;
  job: { title: string; serviceCategory: TradeDataforceServiceCategory; workStage: "imported"; pipelineStage: "imported";
    scheduledStart: string; scheduledEnd: string; description: string; completedWork: string; customerReference: string; createdDate: string; completedDate: string };
  worker: { sourceId: string; displayName: string }; legacy: { status: string; subStatus: string };
  linkedClient?: { sourceFileId: string; sourceRowNumber: number; sourceId: string };
  issues: TradeCrmCsvIssue[]; status: "ready" | "warning" | "error"; excluded: boolean;
};
export type TradeCrmCsvPlan = { files: TradeCrmCsvFile[]; options: TradeCrmCsvOptions; rows: TradeCrmCsvImportRow[];
  fieldMappings: { fileId: string; header: string; target: string; note: string }[];
  summary: { totalRows: number; customerRows: number; jobRows: number; readyRows: number; warningRows: number; errorRows: number; excludedRows: number } };

const normal = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const phoneKey = (value: string) => value.replace(/\D/g, "").replace(/^61(?=[23478]\d{8}$)/, "0");
const localities: Readonly<Record<string, readonly { suburb: string; state: string }[]>> = postcodeLocalities;
export class TradeCrmCsvValidationError extends Error {}
const fail = (message: string): never => { throw new TradeCrmCsvValidationError(message); };
const emptyAddress = (): ImportAddress => ({ addressLine1: "", suburb: "", state: "", postcode: "" });

function address(full: string, street = "", suburb = "", state = "", postcode = ""): ImportAddress {
  const text = (street || full).trim();
  const lines = text.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").replace(/,\s*Australia\s*$/i, "");
  const match = lines.match(/^([\s\S]+?)[,\n]\s*([^,\n]+?)\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+(\d{4})\s*$/i);
  const result = { addressLine1: match ? match[1].trim() : text, suburb: suburb.trim() || match?.[2].trim() || "",
    state: state.trim().toUpperCase() || match?.[3].toUpperCase() || "", postcode: postcode.trim() || match?.[4] || "" };
  if (!result.state && result.postcode) {
    const entries = localities[result.postcode] || [];
    const exact = entries.filter(entry => normal(entry.suburb) === normal(result.suburb));
    const states = new Set((exact.length ? exact : entries).map(entry => entry.state));
    if (states.size === 1) result.state = [...states][0];
  }
  return result;
}

function localDateTime(value: string) {
  if (!value.trim() || /^0000-00-00(?: 00:00:00)?$/.test(value.trim())) return "";
  let parts = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::([0-5]\d))?$/);
  if (!parts) {
    const au = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::([0-5]\d))?$/);
    if (au) parts = [au[0], au[3], au[2], au[1], au[4], au[5]];
  }
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function valueReader(record: Record<string, string>, mapping: TradeCrmCsvMapping) {
  return (field: string) => mapping[field] ? record[mapping[field]]?.trim() || "" : "";
}
function contact(read: ReturnType<typeof valueReader>, prefix: "customer" | "billing", roleLabel: string): ImportContact {
  const full = read(`${prefix}.displayName`).split(/\s+/);
  return { firstName: read(`${prefix}.firstName`) || full[0] || "", lastName: read(`${prefix}.lastName`) || full.slice(1).join(" "),
    email: read(`${prefix}.email`).toLowerCase(), phone: read(`${prefix}.phone`), mobile: read(`${prefix}.mobile`), roleLabel };
}

function project(file: TradeCrmCsvFile, record: Record<string, string>, sourceRowNumber: number, options: TradeCrmCsvOptions): TradeCrmCsvImportRow {
  const read = valueReader(record, file.mapping);
  const issues: TradeCrmCsvIssue[] = [];
  const primary = contact(read, "customer", "Primary contact");
  const billingContact = contact(read, "billing", "Billing contact");
  const customerAddress = address(read("customer.address"));
  const site = file.role === "jobs" ? address(read("site.address"), read("site.street"), read("site.suburb"), read("site.state"), read("site.postcode")) : emptyAddress();
  const customer = { ...primary, displayName: read("customer.displayName") || [primary.firstName, primary.lastName].filter(Boolean).join(" "),
    businessName: read("customer.businessName"), externalReference: read("customer.externalId"), contactPhone: primary.mobile || primary.phone, businessNumber: read("customer.abn") };
  const sourceId = read(file.role === "jobs" ? "job.sourceId" : "customer.externalId");
  const add = (code: string, message: string, level: "warning" | "error" = "warning") => issues.push({ code, message, level, rowNumber: sourceRowNumber });
  if (!sourceId) add("SOURCE_ID_REQUIRED", "A nonempty source ID / key is required for this row.", "error");
  if (!customer.displayName && !customer.businessName) add("CUSTOMER_NAME_REQUIRED", "A contact name or business name is required.", "error");
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) add("EMAIL_REVIEW", "The original email is retained and needs review before use.");
  for (const number of [primary.phone, primary.mobile, billingContact.phone, billingContact.mobile]) {
    if (number && !/^0[23478]\d{8}$/.test(phoneKey(number))) add("PHONE_REVIEW", "A supplied phone number needs review; no area code was invented.");
  }
  if (file.role === "jobs" && (!site.addressLine1 || !site.suburb || !/^[A-Z]{2,3}$/.test(site.state) || !/^\d{4}$/.test(site.postcode))) add("ADDRESS_REVIEW", "The service address is retained but could not be fully separated. Review its street, suburb, state and postcode.");
  const start = localDateTime(read("job.scheduledStart"));
  const end = localDateTime(read("job.scheduledEnd"));
  if (start === null || end === null) add("SCHEDULE_INVALID", "Use an Australian day/month/year time or a local ISO date-time for scheduled visits. No UTC conversion or duration is inferred.", "error");
  if (end && (!start || end < start)) add("SCHEDULE_ORDER_INVALID", "A visit end requires a start and cannot be earlier than it.", "error");
  const rawCategory = read("job.category");
  const override = options.serviceCategoryMappings && Object.hasOwn(options.serviceCategoryMappings, rawCategory) ? options.serviceCategoryMappings[rawCategory] : undefined;
  const serviceCategory = override ?? defaultTradeDataforceServiceCategory(rawCategory);
  if (file.role === "jobs" && serviceCategory === "other" && override === undefined) add("CATEGORY_REVIEW", "Review this source category. The original value remains available.");
  if (/^(sample|example|demo|test)$/i.test(sourceId) || /^help\s*guide\s*job$/i.test(customer.businessName)) add("EXAMPLE_ROW_REVIEW", "This appears to be an example or guide record. Exclude it unless it is intentionally required.");
  const excluded = options.excludedRows && Object.hasOwn(options.excludedRows, file.id) ? options.excludedRows[file.id].includes(sourceRowNumber) : false;
  const customerIdentity = file.role === "customers" ? ["client", sourceId] : ["contact", normal(customer.displayName), normal(customer.businessName),
    customer.email, phoneKey(primary.phone), phoneKey(primary.mobile), normal(customerAddress.addressLine1 || site.addressLine1), normal(customerAddress.suburb || site.suburb), customerAddress.postcode || site.postcode];
  return { rowNumber: 0, sourceRowNumber, sourceFileId: file.id, entityType: file.role === "jobs" ? "job" : "customer", sourceId,
    sourceJobId: file.role === "jobs" ? sourceId : "", sourceAppId: "", record, customerKey: JSON.stringify([options.sourceNamespace, ...customerIdentity]), siteKey: JSON.stringify(site),
    customer, customerAddress, site, contacts: [primary, billingContact].filter(item => item.firstName || item.lastName || item.email || item.phone || item.mobile),
    billing: { ...address(read("billing.address"), read("billing.street"), read("billing.suburb"), read("billing.state"), read("billing.postcode")), country: read("billing.country") },
    paymentTerms: read("customer.paymentTerms"), taxRate: read("customer.taxRate"),
    job: { title: read("job.title") || rawCategory || `Imported job ${sourceId}`, serviceCategory, workStage: "imported", pipelineStage: "imported",
      scheduledStart: start || "", scheduledEnd: end || "", description: read("job.description"), completedWork: read("job.workCompleted"),
      customerReference: read("job.customerReferenceNumber"), createdDate: read("job.createdDate"), completedDate: read("job.completedDate") },
    worker: { sourceId: "", displayName: read("job.worker") }, legacy: { status: read("job.status"), subStatus: "" }, issues,
    status: issues.some(issue => issue.level === "error") ? "error" : issues.length ? "warning" : "ready", excluded };
}

export function prepareTradeCrmCsvImport(files: readonly TradeCrmCsvFile[], options: TradeCrmCsvOptions): TradeCrmCsvPlan {
  if (!Array.isArray(files) || !files.length || files.length > 2) fail("Choose one client file, one jobs file, or one of each.");
  if (!options || typeof options.sourceNamespace !== "string" || !options.sourceNamespace.trim() || options.sourceNamespace.length > 120
    || !["block", "use_job_contacts"].includes(options.unmatchedJobs)) fail("Choose a source account name and how unmatched jobs should be handled.");
  if (options.serviceCategoryMappings && (typeof options.serviceCategoryMappings !== "object" || Array.isArray(options.serviceCategoryMappings)
    || Object.values(options.serviceCategoryMappings).some(value => !isTradeDataforceServiceCategory(value)))) fail("Choose supported service categories for this import.");
  const ids = new Set<string>(); const roles = new Set<string>();
  const rows: TradeCrmCsvImportRow[] = []; const fieldMappings: TradeCrmCsvPlan["fieldMappings"] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(file.id) || ids.has(file.id)
      || !["customers", "jobs"].includes(file.role) || roles.has(file.role) || typeof file.csvText !== "string") fail("Each file needs a unique ID and a different client/jobs role.");
    ids.add(file.id); roles.add(file.role);
    totalBytes += new TextEncoder().encode(file.csvText).byteLength;
    if (totalBytes > 10 * 1024 * 1024) fail("Choose CSV files totalling no more than 10 MB.");
    const parsed = parseStrictImportCsv(file.csvText);
    if (!parsed.rows.length || !parsed.headers.length || parsed.headers.some(header => !header.trim() || header.length > 512) || new Set(parsed.headers).size !== parsed.headers.length) fail("CSV files need unique, nonempty column names of at most 512 characters and at least one row.");
    const fields = file.role === "customers" ? CRM_CSV_CUSTOMER_FIELDS : CRM_CSV_JOB_FIELDS;
    if (!file.mapping || typeof file.mapping !== "object" || Array.isArray(file.mapping)) fail("Review the column mapping for each file.");
    for (const [target, header] of Object.entries(file.mapping)) {
      if (!fields.some(field => field.id === target) || typeof header !== "string" || header && !parsed.headers.includes(header)) fail(`The mapping for ${target} does not name a column in this file.`);
    }
    for (const field of fields.filter(field => field.required)) if (!file.mapping[field.id]) fail(`Map ${field.label} before previewing.`);
    const excluded = options.excludedRows && Object.hasOwn(options.excludedRows, file.id) ? options.excludedRows[file.id] : undefined;
    if (excluded !== undefined && (!Array.isArray(excluded) || excluded.some(row => !Number.isSafeInteger(row) || !parsed.rows.some(item => item.rowNumber === row)))) fail("An excluded row does not exist in its source file.");
    for (const header of parsed.headers) {
      const targets = fields.filter(field => file.mapping[field.id] === header);
      fieldMappings.push({ fileId: file.id, header, target: targets.map(field => field.label).join("; ") || "Original source only",
        note: targets.length ? "The original value is retained alongside the mapped field." : "Preserved exactly. No operational or financial meaning is inferred." });
    }
    for (const row of parsed.rows) {
      if (row.values.length !== parsed.headers.length || !row.values.some(value => value.trim())) fail(`File ${file.fileName}, row ${row.rowNumber}: every source row must match its header columns and contain data.`);
      rows.push(project(file, Object.fromEntries(parsed.headers.map((header, index) => [header, row.values[index]])), row.rowNumber, options));
    }
  }
  if (rows.length > 20_000) fail("An import supports up to 20,000 combined client and job rows.");
  const clients = new Map<string, TradeCrmCsvImportRow[]>();
  for (const row of rows.filter(row => row.entityType === "customer")) clients.set(row.sourceId, [...clients.get(row.sourceId) || [], row]);
  const seen = new Map<string, TradeCrmCsvImportRow[]>();
  for (const row of rows) {
    const key = `${row.entityType}:${row.sourceId}`;
    seen.set(key, [...seen.get(key) || [], row]);
  }
  for (const duplicates of seen.values()) if (duplicates.length > 1) for (const row of duplicates) row.issues.push({ code: "DUPLICATE_SOURCE_ID", level: "error", message: "The source key occurs more than once. Choose a unique source key before importing." });
  const jobFile = files.find(file => file.role === "jobs");
  for (const job of rows.filter(row => row.entityType === "job")) {
    const reference = jobFile ? valueReader(job.record, jobFile.mapping)("job.customerReference") : "";
    const matches = clients.get(reference) || [];
    if (matches.length > 1) job.issues.push({ code: "CLIENT_LINK_AMBIGUOUS", level: "error", message: "More than one client has this key. The job cannot be safely linked." });
    else if (matches.length === 1) {
      const client = matches[0];
      if (client.excluded || client.issues.some(issue => issue.level === "error")) job.issues.push({ code: "CLIENT_LINK_UNAVAILABLE", level: "error", message: "The matching client is excluded or invalid. Resolve the client row before importing its job." });
      else {
        job.customer = client.customer; job.customerAddress = client.customerAddress; job.customerKey = client.customerKey;
        job.contacts = [...client.contacts, ...job.contacts.map(item => ({ ...item, roleLabel: item.roleLabel === "Primary contact" ? "Site contact" : item.roleLabel }))];
        job.billing = client.billing; job.paymentTerms = client.paymentTerms; job.taxRate = client.taxRate;
        job.linkedClient = { sourceFileId: client.sourceFileId, sourceRowNumber: client.sourceRowNumber, sourceId: client.sourceId };
        job.issues = job.issues.filter(issue => issue.code !== "CUSTOMER_NAME_REQUIRED");
      }
    } else if (options.unmatchedJobs === "block") job.issues.push({ code: "CLIENT_LINK_MISSING", level: "error", message: "No matching client was found. Map a matching key or explicitly choose to use the job's own contact details." });
    else job.issues.push({ code: "JOB_CONTACTS_REVIEWED", level: "warning", message: "This job uses its own supplied contact details. It is not joined to an unrelated client row." });
  }
  rows.sort((left, right) => Number(left.entityType === "job") - Number(right.entityType === "job"));
  rows.forEach((row, index) => { row.rowNumber = index + 2; row.status = row.issues.some(issue => issue.level === "error") ? "error" : row.issues.length ? "warning" : "ready"; });
  return { files: [...files], options, rows, fieldMappings, summary: { totalRows: rows.length,
    customerRows: rows.filter(row => row.entityType === "customer").length, jobRows: rows.filter(row => row.entityType === "job").length,
    readyRows: rows.filter(row => row.status === "ready").length, warningRows: rows.filter(row => row.status === "warning").length,
    errorRows: rows.filter(row => row.status === "error").length, excludedRows: rows.filter(row => row.excluded).length } };
}
