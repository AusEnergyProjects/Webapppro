import { DATAFORCE_JOB_CSV_HEADERS, type DataforceJobCsvRecord } from "./creditex-dataforce-job-csv.ts";

/** Source history is separate from current CRM state and verified certificate issuance. */
export function visibleDataforceSource(raw: unknown, access: { protectedCustomer: boolean; canViewInvoices: boolean }): DataforceJobCsvRecord | null {
  if (access.protectedCustomer || typeof raw !== "string" || !raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  if (DATAFORCE_JOB_CSV_HEADERS.some((header) => typeof source[header] !== "string")) return null;
  return Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map((header) => [header,
    !access.canViewInvoices && (header === "Balance" || header === "Invoiced") ? "Restricted" : source[header],
  ])) as DataforceJobCsvRecord;
}
