import type { KeysetDirection } from "@/lib/keyset-pagination";
import type { InstallerCustomerRegisterSort } from "@/lib/trade-crm-register-sorts";

export type CrmSortTerm = {
  expression: string;
  direction: KeysetDirection;
  rowKey: string;
  numeric?: boolean;
};

export type CrmSort = { orderBy: string; terms: CrmSortTerm[] };

export const crmTerm = (
  expression: string,
  direction: KeysetDirection,
  rowKey: string,
  numeric = false,
): CrmSortTerm => ({ expression, direction, rowKey, numeric });

export const crmSort = (terms: CrmSortTerm[], idExpression: string): CrmSort => {
  const stable = [...terms, crmTerm(idExpression, terms.at(-1)?.direction || "asc", "id")];
  return {
    orderBy: stable.map((item) => `${item.expression} ${item.direction.toUpperCase()}`).join(", "),
    terms: stable,
  };
};

export const CUSTOMER_DISPLAY_NAME_SQL = `CASE
  WHEN trim(c.business_name) <> '' THEN trim(c.business_name)
  WHEN trim(c.first_name || ' ' || c.last_name) <> '' THEN trim(c.first_name || ' ' || c.last_name)
  ELSE c.customer_number END`;

export const CUSTOMER_PIPELINE_STATUS_LABEL_SQL = `CASE COALESCE(js.latest_pipeline_stage, '')
  WHEN 'enquiry' THEN 'Lead'
  WHEN 'qualifying' THEN 'Lead checking'
  WHEN 'quoting' THEN 'Quoted / quoting'
  WHEN 'approved' THEN 'Allocated / approved'
  WHEN 'scheduled' THEN 'Scheduled'
  WHEN 'in_progress' THEN 'Work underway'
  WHEN 'complete' THEN 'Completed'
  WHEN 'invoiced' THEN 'Invoiced'
  WHEN 'paid' THEN 'Paid'
  WHEN 'lost' THEN 'Not proceeding'
  ELSE COALESCE(js.latest_pipeline_stage, '') END`;

export const CUSTOMER_REGISTER_SORTS: Record<string, CrmSort> = {
  "name-asc": crmSort([crmTerm(`${CUSTOMER_DISPLAY_NAME_SQL} COLLATE NOCASE`, "asc", "customer_display_name_sort"), crmTerm("c.customer_number COLLATE NOCASE", "asc", "customer_number")], "c.id"),
  "name-desc": crmSort([crmTerm(`${CUSTOMER_DISPLAY_NAME_SQL} COLLATE NOCASE`, "desc", "customer_display_name_sort"), crmTerm("c.customer_number COLLATE NOCASE", "desc", "customer_number")], "c.id"),
  "first-name-asc": crmSort([crmTerm("(trim(c.first_name) = '')", "asc", "first_name_empty", true), crmTerm("c.first_name COLLATE NOCASE", "asc", "first_name"), crmTerm("c.last_name COLLATE NOCASE", "asc", "last_name")], "c.id"),
  "first-name-desc": crmSort([crmTerm("(trim(c.first_name) = '')", "asc", "first_name_empty", true), crmTerm("c.first_name COLLATE NOCASE", "desc", "first_name"), crmTerm("c.last_name COLLATE NOCASE", "desc", "last_name")], "c.id"),
  "last-name-asc": crmSort([crmTerm("(trim(c.last_name) = '')", "asc", "last_name_empty", true), crmTerm("c.last_name COLLATE NOCASE", "asc", "last_name"), crmTerm("c.first_name COLLATE NOCASE", "asc", "first_name")], "c.id"),
  "last-name-desc": crmSort([crmTerm("(trim(c.last_name) = '')", "asc", "last_name_empty", true), crmTerm("c.last_name COLLATE NOCASE", "desc", "last_name"), crmTerm("c.first_name COLLATE NOCASE", "desc", "first_name")], "c.id"),
  "email-asc": crmSort([crmTerm("(trim(c.email) = '')", "asc", "email_empty", true), crmTerm("c.email COLLATE NOCASE", "asc", "email")], "c.id"),
  "email-desc": crmSort([crmTerm("(trim(c.email) = '')", "asc", "email_empty", true), crmTerm("c.email COLLATE NOCASE", "desc", "email")], "c.id"),
  "phone-asc": crmSort([crmTerm("(trim(c.phone) = '')", "asc", "phone_empty", true), crmTerm("c.phone COLLATE NOCASE", "asc", "phone")], "c.id"),
  "phone-desc": crmSort([crmTerm("(trim(c.phone) = '')", "asc", "phone_empty", true), crmTerm("c.phone COLLATE NOCASE", "desc", "phone")], "c.id"),
  "suburb-asc": crmSort([crmTerm("(trim(c.suburb) = '')", "asc", "suburb_empty", true), crmTerm("c.suburb COLLATE NOCASE", "asc", "suburb")], "c.id"),
  "suburb-desc": crmSort([crmTerm("(trim(c.suburb) = '')", "asc", "suburb_empty", true), crmTerm("c.suburb COLLATE NOCASE", "desc", "suburb")], "c.id"),
  "postcode-asc": crmSort([crmTerm("(trim(c.postcode) = '')", "asc", "postcode_empty", true), crmTerm("c.postcode COLLATE NOCASE", "asc", "postcode")], "c.id"),
  "postcode-desc": crmSort([crmTerm("(trim(c.postcode) = '')", "asc", "postcode_empty", true), crmTerm("c.postcode COLLATE NOCASE", "desc", "postcode")], "c.id"),
  "jobs-asc": crmSort([crmTerm("COALESCE(js.job_count, 0)", "asc", "job_count", true)], "c.id"),
  "jobs-desc": crmSort([crmTerm("COALESCE(js.job_count, 0)", "desc", "job_count", true)], "c.id"),
  "created-desc": crmSort([crmTerm("c.created_at", "desc", "created_at")], "c.id"),
  "created-asc": crmSort([crmTerm("c.created_at", "asc", "created_at")], "c.id"),
  "latest-job-asc": crmSort([crmTerm("(COALESCE(js.latest_job_at, '') = '')", "asc", "latest_job_empty", true), crmTerm("COALESCE(js.latest_job_at, '')", "asc", "latest_job_at")], "c.id"),
  "latest-job-desc": crmSort([crmTerm("(COALESCE(js.latest_job_at, '') = '')", "asc", "latest_job_empty", true), crmTerm("COALESCE(js.latest_job_at, '')", "desc", "latest_job_at")], "c.id"),
  "status-asc": crmSort([crmTerm("(COALESCE(js.latest_pipeline_stage, '') = '')", "asc", "customer_status_empty", true), crmTerm(`${CUSTOMER_PIPELINE_STATUS_LABEL_SQL} COLLATE NOCASE`, "asc", "customer_status_sort")], "c.id"),
  "status-desc": crmSort([crmTerm("(COALESCE(js.latest_pipeline_stage, '') = '')", "asc", "customer_status_empty", true), crmTerm(`${CUSTOMER_PIPELINE_STATUS_LABEL_SQL} COLLATE NOCASE`, "desc", "customer_status_sort")], "c.id"),
  "updated-desc": crmSort([crmTerm("c.updated_at", "desc", "updated_at")], "c.id"),
} satisfies Record<InstallerCustomerRegisterSort, CrmSort>;

export const CUSTOMER_JOB_DERIVED_SORTS = new Set<InstallerCustomerRegisterSort>([
  "jobs-asc", "jobs-desc",
  "latest-job-asc", "latest-job-desc",
  "status-asc", "status-desc",
]);
