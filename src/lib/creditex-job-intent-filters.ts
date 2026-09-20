const CUSTOMER_NAME_SQL = "COALESCE(NULLIF(trim(customer.business_name), ''), trim(COALESCE(customer.first_name, '') || ' ' || COALESCE(customer.last_name, '')))";
const SORT_COLUMNS = {
  plannedStart: "intent.planned_start",
  jobNumber: "work.work_number COLLATE NOCASE",
  customerName: `${CUSTOMER_NAME_SQL} COLLATE NOCASE`,
  installerBusiness: "account.business_name COLLATE NOCASE",
  programCode: "intent.program_code COLLATE NOCASE",
  jobStage: "work.stage COLLATE NOCASE",
  priority: "CASE work.priority WHEN 'low' THEN 1 WHEN 'standard' THEN 2 WHEN 'high' THEN 3 WHEN 'urgent' THEN 4 ELSE 0 END",
  updatedAt: "intent.updated_at",
} as const;

export class CreditexQueueFilterError extends Error {}

export function creditexQueueLike(value: string) {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function dateFilter(params: URLSearchParams, key: string) {
  const value = params.get(key) || "";
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new CreditexQueueFilterError("Choose a valid planned date.");
  return value;
}

export function creditexJobIntentFilters(params: URLSearchParams) {
  const conditions: string[] = [];
  const bindings: string[] = [];
  const value = (key: string) => (params.get(key) || "").trim().slice(0, 120);
  for (const [key, column] of [["program", "intent.program_code"], ["jobStage", "work.stage"], ["priority", "work.priority"], ["quoteStatus", "details.quote_status"], ["invoiceStatus", "details.invoice_status"]]) {
    const filter = value(key);
    if (filter && filter !== "all") { conditions.push(`${column} = ? COLLATE NOCASE`); bindings.push(filter); }
  }
  const textFilters: [string, string][] = [
    ["job", "COALESCE(work.work_number, '') || ' ' || COALESCE(work.title, '')"],
    ["installer", "account.business_name"],
    ["customer", `${CUSTOMER_NAME_SQL} || ' ' || COALESCE(customer.customer_number, '')`],
    ["serviceSite", "COALESCE(site.address_line_1, '') || ' ' || COALESCE(site.address_line_2, '') || ' ' || COALESCE(site.suburb, '') || ' ' || COALESCE(site.address_state, '') || ' ' || COALESCE(site.postcode, '')"],
    ["activity", "COALESCE(intent.registry_activity_code, '') || ' ' || COALESCE(json_extract(intent.intent_snapshot, '$.activity.title'), '')"],
  ];
  for (const [key, column] of textFilters) {
    const filter = value(key);
    if (filter) { conditions.push(`(${column}) LIKE ? ESCAPE '\\'`); bindings.push(creditexQueueLike(filter)); }
  }
  const from = dateFilter(params, "plannedFrom");
  const to = dateFilter(params, "plannedTo");
  if (from && to && from > to) throw new CreditexQueueFilterError("The planned end date must be on or after the start date.");
  if (from) { conditions.push("substr(intent.planned_start, 1, 10) >= ?"); bindings.push(from); }
  if (to) { conditions.push("intent.planned_start <> '' AND substr(intent.planned_start, 1, 10) <= ?"); bindings.push(to); }
  const requestedSort = params.get("sort") || "plannedStart";
  if (!Object.hasOwn(SORT_COLUMNS, requestedSort)) throw new CreditexQueueFilterError("Choose a supported job-list sort column.");
  const sort = requestedSort as keyof typeof SORT_COLUMNS;
  const sortDirection = params.get("sortDirection") || "asc";
  if (!["asc", "desc"].includes(sortDirection)) throw new CreditexQueueFilterError("Choose an ascending or descending sort.");
  const order = sortDirection === "desc" ? "DESC" : "ASC";
  const sortSql = `${sort === "plannedStart" ? "CASE WHEN COALESCE(intent.planned_start, '') = '' THEN 1 ELSE 0 END, " : ""}${SORT_COLUMNS[sort]} ${order}, intent.id ASC`;
  return { filterSql: conditions.length ? `AND ${conditions.join(" AND ")}` : "", filterBindings: bindings, sortSql, sort, sortDirection };
}
