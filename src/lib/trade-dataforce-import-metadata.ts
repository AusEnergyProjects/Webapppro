import { DATAFORCE_JOB_CSV_HEADERS, type DataforceJobCsvHeader } from "./creditex-dataforce-job-csv.ts";
import { ENERGY_SERVICE_CATALOGUE, ENERGY_SERVICE_IDS } from "./energy-service-catalogue.mjs";

export const TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS = [
  ...ENERGY_SERVICE_CATALOGUE.map(({ id, label }) => ({ value: id, label })),
  { value: "mounting-hardware", label: "Mounting hardware" },
  { value: "controls", label: "Controls" },
];
export type TradeDataforceServiceCategory = typeof TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS[number]["value"];

const supportedServiceCategories = new Set([...ENERGY_SERVICE_IDS, "electrical", "plumbing", "mounting-hardware", "controls"]);

export function isTradeDataforceServiceCategory(value: unknown): value is TradeDataforceServiceCategory {
  return typeof value === "string" && supportedServiceCategories.has(value);
}

export function defaultTradeDataforceServiceCategory(workType: string): TradeDataforceServiceCategory {
  return workType.trim().replace(/\s+/g, " ").toLowerCase() === "home energy rating assessment" ? "assessment" : "other";
}

export const TRADE_DATAFORCE_FIELD_MAPPINGS = [
  { header: "App Id", target: "Source appointment ID", note: "Retained separately from the source job ID." },
  { header: "Job Id", target: "Source job ID", note: "Used to prevent importing the same Dataforce job twice in this business." },
  { header: "Status", target: "Job work stage and source status", note: "Maps the operational stage; does not certify regulatory approval." },
  { header: "SubStatus", target: "Source substatus", note: "Partial work remains in progress. Audit labels are retained as source facts." },
  { header: "Type", target: "Source job type", note: "Retained without changing the source meaning." },
  { header: "Work Type", target: "Job title and service category", note: "Known assessments map to Assessment. Review any other work type for this import; its original title is always retained." },
  { header: "Scheduled Datetime", target: "Scheduled local date and time", note: "Keeps the Australian local wall-clock time. No end time or duration is invented." },
  { header: "Balance", target: "Source balance", note: "Preserved separately; does not create invoices or payments." },
  { header: "Certificates (VEECs)", target: "Source VEEC quantity", note: "Retained as a source quantity, not verified certificate issuance." },
  { header: "Submission", target: "Source submission status", note: "Retained as reported by Dataforce, without creating an official submission." },
  { header: "Invoiced", target: "Source invoicing status", note: "Blank means not supplied. Invoice history cannot be inferred from this export." },
  { header: "Field Worker", target: "Source worker ID and name", note: "Preserves the worker label without granting access or assigning a different team account." },
  { header: "Agent", target: "Source agent", note: "Retained for provenance. Records belong to the signed-in importing business." },
  { header: "Client", target: "Source client", note: "Preserved as source context, not interpreted as workspace ownership." },
  { header: "Customer", target: "Customer name", note: "Full source name is retained. First word and remaining words populate the editable name fields." },
  { header: "Company Name", target: "Customer business name", note: "Retained alongside the contact name." },
  { header: "Ext Cust Ref", target: "External customer reference", note: "Retained separately from TLink record IDs." },
  { header: "Phone", target: "Customer phone", note: "Preserved independently of Mobile." },
  { header: "Mobile", target: "Customer mobile and primary contact number", note: "Preferred for the primary contact number when supplied; Phone remains retained." },
  { header: "Email", target: "Customer email", note: "Normalised for matching; the original source value is retained." },
  { header: "Address", target: "Job service-site street address", note: "Each job retains its own site, even when a contact has multiple properties." },
  { header: "Suburb", target: "Job service-site suburb", note: "Retains the supplied locality name." },
  { header: "Postcode", target: "Job service-site postcode and derived state", note: "State is derived only from the existing exact postcode/locality table, with unresolved localities flagged." },
] satisfies readonly { header: DataforceJobCsvHeader; target: string; note: string }[];

export function isTradeDataforceImport(headers: readonly string[]) {
  return headers.length === DATAFORCE_JOB_CSV_HEADERS.length
    && new Set(headers).size === headers.length
    && DATAFORCE_JOB_CSV_HEADERS.every((header) => headers.includes(header));
}
