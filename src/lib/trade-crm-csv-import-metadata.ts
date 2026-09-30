import { parseStrictImportCsv } from "./creditex-dataforce-job-csv.ts";

export type TradeCrmCsvRole = "customers" | "jobs";
export type TradeCrmCsvMapping = Readonly<Record<string, string>>;
export type TradeCrmCsvField = { id: string; label: string; required?: boolean; aliases: readonly string[] };

const contactFields: readonly TradeCrmCsvField[] = [
  { id: "customer.displayName", label: "Contact full name", aliases: ["Customer", "Customer Name", "Contact Name"] },
  { id: "customer.firstName", label: "Contact first name", aliases: ["Contact First", "First Name", "first_name"] },
  { id: "customer.lastName", label: "Contact last name", aliases: ["Contact Last", "Last Name", "last_name"] },
  { id: "customer.businessName", label: "Business / client name", aliases: ["Name", "Company", "Company Name", "business_name"] },
  { id: "customer.email", label: "Contact email", aliases: ["Email Address", "Job Email Address", "Email", "email"] },
  { id: "customer.phone", label: "Contact telephone", aliases: ["Telephone Number", "Job Telephone Number", "Phone", "phone"] },
  { id: "customer.mobile", label: "Contact mobile", aliases: ["Mobile Number", "Job Contact Mobile Number", "Mobile", "mobile"] },
  { id: "customer.address", label: "Customer / company full address", aliases: ["Company Address"] },
  { id: "billing.firstName", label: "Billing contact first name", aliases: ["Billing Contact First"] },
  { id: "billing.lastName", label: "Billing contact last name", aliases: ["Billing Contact Last"] },
  { id: "billing.email", label: "Billing contact email", aliases: ["Billing Email Address"] },
  { id: "billing.phone", label: "Billing contact telephone", aliases: ["Billing Telephone Number"] },
  { id: "billing.mobile", label: "Billing contact mobile", aliases: ["Billing Mobile Number", "Billing Contact Mobile Number"] },
  { id: "billing.address", label: "Billing full address", aliases: ["Billing Address"] },
  { id: "billing.street", label: "Billing street", aliases: ["Billing Address Street"] },
  { id: "billing.suburb", label: "Billing suburb / city", aliases: ["Billing Address City"] },
  { id: "billing.state", label: "Billing state", aliases: ["Billing Address State"] },
  { id: "billing.postcode", label: "Billing postcode", aliases: ["Billing Address Postcode"] },
  { id: "billing.country", label: "Billing country", aliases: ["Billing Address Country"] },
  { id: "customer.abn", label: "Original ABN (source information)", aliases: ["ABN Number", "ABN"] },
  { id: "customer.paymentTerms", label: "Original payment terms", aliases: ["Payment Terms"] },
  { id: "customer.taxRate", label: "Original tax rate", aliases: ["Tax Rate"] },
];
export const CRM_CSV_CUSTOMER_FIELDS: readonly TradeCrmCsvField[] = [
  { id: "customer.externalId", label: "Unique source client ID / key", required: true, aliases: ["Client ID", "Customer ID", "customer_id", "Name"] },
  ...contactFields,
];
export const CRM_CSV_JOB_FIELDS: readonly TradeCrmCsvField[] = [
  { id: "job.sourceId", label: "Unique source job ID / number", required: true, aliases: ["Job Number", "Job Id", "Job ID", "job_id", "job_number"] },
  { id: "job.customerReference", label: "Client key matching the client file", aliases: ["Client ID", "Customer ID", "customer_id", "Company"] },
  { id: "job.title", label: "Job title", aliases: ["Job Title", "Title", "title", "Work Type"] },
  { id: "job.category", label: "Service category to review", aliases: ["Job Category", "Category", "service_category"] },
  { id: "job.description", label: "Description of work", aliases: ["Description of work", "Description", "description"] },
  { id: "job.status", label: "Original status (all new jobs start Imported)", aliases: ["Job Status", "Status", "status"] },
  { id: "job.scheduledStart", label: "Scheduled visit date and time", aliases: ["Scheduled Datetime", "Scheduled Start", "scheduled_start"] },
  { id: "job.scheduledEnd", label: "Scheduled visit end date and time", aliases: ["Scheduled End", "scheduled_end"] },
  { id: "job.createdDate", label: "Original job date", aliases: ["Date", "Created Date", "created_at"] },
  { id: "job.completedDate", label: "Original completion date", aliases: ["Completion Date", "completed_at"] },
  { id: "job.workCompleted", label: "Work completed notes", aliases: ["Work Completed"] },
  { id: "job.customerReferenceNumber", label: "Purchase order / customer reference", aliases: ["PO Number", "Customer Reference", "customer_reference"] },
  { id: "job.worker", label: "Original worker label (no automatic team access)", aliases: ["Field Worker", "Assigned To", "assignee_label"] },
  { id: "site.address", label: "Full service address", aliases: ["Job Address", "Site Address", "Address", "address"] },
  { id: "site.street", label: "Service street address", aliases: ["Address Line 1", "address_line_1"] },
  { id: "site.suburb", label: "Service suburb / city", aliases: ["Suburb", "City", "suburb"] },
  { id: "site.state", label: "Service state", aliases: ["State", "address_state"] },
  { id: "site.postcode", label: "Service postcode", aliases: ["Postcode", "postcode"] },
  ...contactFields,
];

export function readTradeCrmCsvHeaders(source: string) {
  return parseStrictImportCsv(source).headers;
}
export function detectTradeCrmCsvRole(headers: readonly string[]): TradeCrmCsvRole | null {
  if (headers.includes("Job Number") || headers.includes("Job Id") || headers.includes("job_id")) return "jobs";
  if (headers.includes("Name") && headers.includes("Company Address") || headers.includes("Customer ID")) return "customers";
  return null;
}
export function suggestTradeCrmCsvMapping(headers: readonly string[], role: TradeCrmCsvRole): Record<string, string> {
  return Object.fromEntries((role === "customers" ? CRM_CSV_CUSTOMER_FIELDS : CRM_CSV_JOB_FIELDS)
    .flatMap(field => {
      const exact = field.aliases.find(alias => headers.includes(alias));
      return exact ? [[field.id, exact]] : [];
    }));
}
