import { jobCreationDayStart } from "./job-register-dates.ts";

export const ADMIN_JOB_SORTS = {
  "created-desc": "w.created_at DESC, w.id ASC",
  "created-asc": "w.created_at ASC, w.id ASC",
  "first-name-asc": "c.first_name COLLATE NOCASE ASC, w.id ASC",
  "last-name-asc": "c.last_name COLLATE NOCASE ASC, w.id ASC",
  "updated-desc": "w.updated_at DESC, w.id ASC",
  "updated-asc": "w.updated_at ASC, w.id ASC",
  "scheduled-asc": "CASE WHEN w.scheduled_start = '' THEN 1 ELSE 0 END, w.scheduled_start ASC, w.id ASC",
  "scheduled-desc": "w.scheduled_start DESC, w.id ASC",
  "number-asc": "w.work_number ASC, w.id ASC",
  "customer-asc": "customer_name COLLATE NOCASE ASC, w.id ASC",
  "installer-asc": "a.business_name COLLATE NOCASE ASC, w.id ASC",
} as const;
export type AdminJobSort = keyof typeof ADMIN_JOB_SORTS;
export type AdminJobRow = {
  id: string; workNumber: string; title: string; serviceCategory: string; stage: string;
  siteArea: string; scheduledStart: string; installerBusiness: string; customerName: string; updatedAt: string;
  customerFirstName: string; customerLastName: string; customerBusinessName: string; createdAt: string;
};
const clean = (value: string | null, max = 100) => (value || "").trim().slice(0, max);
function dateFilter(value: string | null) {
  const raw = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : "";
}
export function adminJobQuery(params: URLSearchParams) {
  const filters = {
    query: clean(params.get("q")), stage: clean(params.get("stage"), 50), service: clean(params.get("service"), 80),
    installer: clean(params.get("installer")), from: dateFilter(params.get("from")), to: dateFilter(params.get("to")),
    firstName: clean(params.get("firstName")), lastName: clean(params.get("lastName")),
    createdFrom: dateFilter(params.get("createdFrom")), createdTo: dateFilter(params.get("createdTo")),
  };
  const requestedSort = params.get("sort") || "updated-desc";
  const sort: AdminJobSort = Object.hasOwn(ADMIN_JOB_SORTS, requestedSort) ? requestedSort as AdminJobSort : "updated-desc";
  const requestedPage = Number(params.get("page") || 1);
  const page = Number.isInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, 201)) : 1;
  const pageSize = 50;
  const conditions = ["w.partner_type = 'installer'", "w.record_status = 'active'"];
  const values: string[] = [];
  for (const [column, value] of [["c.first_name", filters.firstName], ["c.last_name", filters.lastName]]) {
    if (value) {
      conditions.push(`LOWER(${column}) LIKE ? ESCAPE '\\'`);
      values.push(`%${value.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`);
    }
  }
  if (filters.query) {
    const term = `%${filters.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push("(LOWER(w.id) LIKE ? ESCAPE '\\' OR LOWER(w.work_number) LIKE ? ESCAPE '\\' OR LOWER(w.title) LIKE ? ESCAPE '\\' OR LOWER(a.business_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.business_name, '') || ' ' || COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ? ESCAPE '\\' OR LOWER(w.site_area) LIKE ? ESCAPE '\\')");
    values.push(term, term, term, term, term, term);
  }
  for (const [column, value] of [["w.stage", filters.stage], ["w.service_category", filters.service], ["a.business_name", filters.installer]]) {
    if (value) { conditions.push(`${column} = ?`); values.push(value); }
  }
  if (filters.from) { conditions.push("substr(w.scheduled_start, 1, 10) >= ?"); values.push(filters.from); }
  if (filters.to) { conditions.push("substr(w.scheduled_start, 1, 10) <= ?"); values.push(filters.to); }
  if (filters.createdFrom) { conditions.push("datetime(w.created_at) >= datetime(?)"); values.push(jobCreationDayStart(filters.createdFrom)); }
  if (filters.createdTo) { conditions.push("datetime(w.created_at) < datetime(?)"); values.push(jobCreationDayStart(filters.createdTo, true)); }
  return { filters, sort, page, pageSize, offset: (page - 1) * pageSize, where: conditions.join(" AND "), values, orderBy: ADMIN_JOB_SORTS[sort] };
}

export const ADMIN_JOB_JOINS = `FROM trade_work_orders w
  JOIN trade_accounts a ON a.firebase_uid = w.firebase_uid
  LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
  LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid`;
