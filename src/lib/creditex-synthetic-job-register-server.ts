import type { ComplianceIdentity } from "./compliance-access-server.ts";
import {
  DATAFORCE_JOB_CSV_HEADERS,
  type DataforceJobCsvHeader,
  type DataforceJobCsvRecord,
} from "./creditex-dataforce-job-csv.ts";

export const CREDITEX_SYNTHETIC_REGISTER_CONTRACT_VERSION =
  "dataforce-jobs-v1" as const;

export const CREDITEX_SYNTHETIC_REGISTER_SOURCES = [
  "veu_pilot",
  "manual_evidence",
] as const;

export type CreditexSyntheticRegisterSource =
  typeof CREDITEX_SYNTHETIC_REGISTER_SOURCES[number];

const REGISTER_PAGE_SIZES = new Set([25, 50, 100, 300]);
const REGISTER_SOURCES = new Set<string>(
  CREDITEX_SYNTHETIC_REGISTER_SOURCES,
);

const SORT_EXPRESSIONS = {
  appId: "app_id",
  jobId: "job_id",
  status: "status_cell",
  subStatus: "sub_status",
  type: "type_cell",
  workType: "work_type",
  scheduledDatetime: "scheduled_datetime",
  balance: "balance",
  certificates: "certificates",
  submission: "submission",
  invoiced: "invoiced",
  fieldWorker: "field_worker",
  agent: "agent",
  client: "client",
  customer: "customer",
  companyName: "company_name",
  extCustRef: "ext_cust_ref",
  phone: "phone",
  mobile: "mobile",
  email: "email",
  address: "address",
  suburb: "suburb",
  postcode: "postcode",
} as const;

export type CreditexSyntheticRegisterSortKey =
  keyof typeof SORT_EXPRESSIONS;

export type CreditexSyntheticRegisterFilters = {
  source: CreditexSyntheticRegisterSource | "";
  programCode: string;
  activityTemplateId: string;
  installerId: string;
  technicianId: string;
  status: string;
  postcode: string;
  query: string;
  sortBy: CreditexSyntheticRegisterSortKey;
  sortDirection: "asc" | "desc";
  page: number;
  pageSize: number;
};

export type CreditexSyntheticRegisterFacet = {
  value: string;
  label: string;
  count: number;
  parentValue?: string;
};

export type CreditexSyntheticRegisterRow = {
  rowKey: `${CreditexSyntheticRegisterSource}:${string}`;
  source: CreditexSyntheticRegisterSource;
  sourceId: string;
  recordMode: "synthetic_test";
  programCode: string;
  activityTemplateId: string;
  installerId: string;
  technicianId: string;
  status: string;
  revision: number;
  updatedAt: string;
  cells: DataforceJobCsvRecord;
};

export class CreditexSyntheticRegisterError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreditexSyntheticRegisterError";
    this.code = code;
    this.status = status;
  }
}

type RegisterSqlRow = Record<string, unknown> & {
  source: CreditexSyntheticRegisterSource;
  source_id: string;
  record_mode: string;
  program_code: string;
  activity_template_id: string;
  installer_id: string;
  technician_id: string;
  status_value: string;
  revision: number;
  updated_at: string;
  app_id: string;
  job_id: string;
  status_cell: string;
  sub_status: string;
  type_cell: string;
  work_type: string;
  scheduled_datetime: string;
  balance: string;
  certificates: string;
  submission: string;
  invoiced: string;
  field_worker: string;
  agent: string;
  client: string;
  customer: string;
  company_name: string;
  ext_cust_ref: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  suburb: string;
  postcode: string;
};

type FacetSqlRow = {
  facet: string;
  value: string;
  label: string;
  parent_value: string;
  option_count: number;
};

const DATAFORCE_ROW_FIELDS = {
  "App Id": "app_id",
  "Job Id": "job_id",
  Status: "status_cell",
  SubStatus: "sub_status",
  Type: "type_cell",
  "Work Type": "work_type",
  "Scheduled Datetime": "scheduled_datetime",
  Balance: "balance",
  "Certificates (VEECs)": "certificates",
  Submission: "submission",
  Invoiced: "invoiced",
  "Field Worker": "field_worker",
  Agent: "agent",
  Client: "client",
  Customer: "customer",
  "Company Name": "company_name",
  "Ext Cust Ref": "ext_cust_ref",
  Phone: "phone",
  Mobile: "mobile",
  Email: "email",
  Address: "address",
  Suburb: "suburb",
  Postcode: "postcode",
} as const satisfies Record<DataforceJobCsvHeader, keyof RegisterSqlRow>;

const REGISTER_CTE = `WITH register_rows AS (
  SELECT
    'veu_pilot' AS source,
    job.id AS source_id,
    job.record_mode AS record_mode,
    run.program_code AS program_code,
    job.activity_template_id AS activity_template_id,
    job.title AS activity_title,
    installer.id AS installer_id,
    installer.business_name AS installer_label,
    technician.id AS technician_id,
    technician.display_name AS technician_label,
    job.review_status AS status_value,
    work.revision AS revision,
    job.updated_at AS updated_at,
    COALESCE(appointment.id, '') AS app_id,
    job.job_number AS job_id,
    job.review_status AS status_cell,
    '' AS sub_status,
    '' AS type_cell,
    work.work_type AS work_type,
    COALESCE(appointment.starts_at, '') AS scheduled_datetime,
    '' AS balance,
    CASE
      WHEN run.program_code = 'VEU'
        THEN 'Blocked: no issued VEECs'
      ELSE ''
    END AS certificates,
    job.connector_status AS submission,
    COALESCE(detail.invoice_status, '') AS invoiced,
    technician.display_name AS field_worker,
    '' AS agent,
    '' AS client,
    TRIM(
      COALESCE(customer.first_name, '') || ' ' ||
      COALESCE(customer.last_name, '')
    ) AS customer,
    COALESCE(customer.business_name, '') AS company_name,
    COALESCE(customer.customer_number, '') AS ext_cust_ref,
    COALESCE(customer.phone, '') AS phone,
    '' AS mobile,
    COALESCE(customer.email, '') AS email,
    TRIM(
      COALESCE(site.address_line_1, '') ||
      CASE
        WHEN COALESCE(site.address_line_2, '') = '' THEN ''
        ELSE ', ' || site.address_line_2
      END
    ) AS address,
    COALESCE(site.suburb, '') AS suburb,
    COALESCE(site.postcode, '') AS postcode
  FROM compliance_pilot_jobs job
  JOIN compliance_pilot_runs run
    ON run.id = job.pilot_run_id
    AND run.organisation_id = ?
    AND run.record_mode = 'synthetic_test'
    AND run.status = 'active'
  JOIN compliance_pilot_installers installer
    ON installer.id = job.installer_id
    AND installer.pilot_run_id = job.pilot_run_id
  JOIN compliance_pilot_technicians technician
    ON technician.id = job.technician_id
    AND technician.pilot_run_id = job.pilot_run_id
  JOIN trade_work_orders work
    ON work.id = job.work_order_id
    AND work.firebase_uid = installer.trade_account_uid
    AND work.source_type = 'synthetic_pilot'
    AND work.source_reference = job.pilot_run_id
    AND work.record_status = 'active'
  LEFT JOIN trade_crm_job_details detail
    ON detail.work_order_id = work.id
    AND detail.firebase_uid = work.firebase_uid
  LEFT JOIN trade_crm_customers customer
    ON customer.id = detail.crm_customer_id
    AND customer.firebase_uid = work.firebase_uid
    AND customer.record_status = 'active'
  LEFT JOIN trade_crm_service_sites site
    ON site.id = detail.service_site_id
    AND site.firebase_uid = work.firebase_uid
    AND site.record_status = 'active'
  LEFT JOIN trade_crm_appointments appointment
    ON appointment.id = (
      SELECT candidate.id
      FROM trade_crm_appointments candidate
      WHERE candidate.work_order_id = work.id
        AND candidate.firebase_uid = work.firebase_uid
      ORDER BY candidate.starts_at DESC, candidate.id DESC
      LIMIT 1
    )
  WHERE job.record_mode = 'synthetic_test'

  UNION ALL

  SELECT
    'manual_evidence' AS source,
    job.id AS source_id,
    job.record_mode AS record_mode,
    job.program_code AS program_code,
    job.activity_template_id AS activity_template_id,
    CAST(
      COALESCE(
        json_extract(job.activity_snapshot, '$.activity.title'),
        ''
      ) AS TEXT
    ) AS activity_title,
    job.installer_id AS installer_id,
    job.installer_label AS installer_label,
    job.technician_id AS technician_id,
    job.technician_label AS technician_label,
    job.status AS status_value,
    job.revision AS revision,
    job.updated_at AS updated_at,
    '' AS app_id,
    job.job_number AS job_id,
    job.status AS status_cell,
    '' AS sub_status,
    '' AS type_cell,
    CAST(
      COALESCE(
        json_extract(job.activity_snapshot, '$.activity.title'),
        ''
      ) AS TEXT
    ) AS work_type,
    '' AS scheduled_datetime,
    '' AS balance,
    '' AS certificates,
    '' AS submission,
    '' AS invoiced,
    job.technician_label AS field_worker,
    '' AS agent,
    '' AS client,
    job.customer_label AS customer,
    '' AS company_name,
    '' AS ext_cust_ref,
    '' AS phone,
    '' AS mobile,
    '' AS email,
    '' AS address,
    '' AS suburb,
    job.site_postcode AS postcode
  FROM compliance_manual_evidence_test_jobs job
  WHERE job.organisation_id = ?
    AND job.record_mode = 'synthetic_test'
)`;

const FACET_QUERIES = [
  {
    facet: "source",
    value: "source",
    label: `CASE source
      WHEN 'veu_pilot' THEN 'VEU pilot'
      ELSE 'Manual evidence'
    END`,
    parentValue: "''",
    groupBy: "source",
  },
  {
    facet: "program",
    value: "program_code",
    label: "program_code",
    parentValue: "''",
    groupBy: "program_code",
  },
  {
    facet: "activity",
    value: "activity_template_id",
    label: "activity_title",
    parentValue: "program_code",
    groupBy: "activity_template_id, activity_title, program_code",
  },
  {
    facet: "installer",
    value: "installer_id",
    label: "installer_label",
    parentValue: "source",
    groupBy: "installer_id, installer_label, source",
  },
  {
    facet: "technician",
    value: "technician_id",
    label: "technician_label",
    parentValue: "installer_id",
    groupBy: "technician_id, technician_label, installer_id",
  },
  {
    facet: "status",
    value: "status_value",
    label: "status_value",
    parentValue: "''",
    groupBy: "status_value",
  },
  {
    facet: "postcode",
    value: "postcode",
    label: "postcode",
    parentValue: "''",
    groupBy: "postcode",
  },
] as const;

function boundedParameter(
  searchParams: URLSearchParams,
  name: string,
  maximumLength: number,
) {
  const value = String(searchParams.get(name) || "").trim();
  if (
    value.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_FILTER_INVALID",
      400,
      `Enter a valid ${name} filter.`,
    );
  }
  return value;
}

function integerParameter(
  searchParams: URLSearchParams,
  name: string,
  fallback: number,
) {
  const raw = String(searchParams.get(name) || "").trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_FILTER_INVALID",
      400,
      `Enter a valid ${name}.`,
    );
  }
  return Number(raw);
}

export function parseCreditexSyntheticRegisterFilters(
  searchParams: URLSearchParams,
): CreditexSyntheticRegisterFilters {
  const requestedSource = boundedParameter(
    searchParams,
    "source",
    32,
  );
  const source = requestedSource === "all" ? "" : requestedSource;
  if (source && !REGISTER_SOURCES.has(source)) {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_SOURCE_INVALID",
      400,
      "Choose a supported synthetic record source.",
    );
  }

  const requestedSort = boundedParameter(
    searchParams,
    "sortBy",
    32,
  ) || "jobId";
  if (!(requestedSort in SORT_EXPRESSIONS)) {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_SORT_INVALID",
      400,
      "Choose a supported Dataforce register column.",
    );
  }

  const requestedDirection = boundedParameter(
    searchParams,
    "sortDirection",
    4,
  ) || "asc";
  if (requestedDirection !== "asc" && requestedDirection !== "desc") {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_SORT_INVALID",
      400,
      "Choose ascending or descending sort order.",
    );
  }

  const page = integerParameter(searchParams, "page", 0);
  const pageSize = integerParameter(searchParams, "pageSize", 50);
  if (
    !Number.isSafeInteger(page)
    || page < 0
    || !REGISTER_PAGE_SIZES.has(pageSize)
  ) {
    throw new CreditexSyntheticRegisterError(
      "CREDITEX_SYNTHETIC_REGISTER_PAGE_INVALID",
      400,
      "Choose a supported synthetic register page.",
    );
  }

  return {
    source: source as CreditexSyntheticRegisterSource | "",
    programCode: boundedParameter(searchParams, "programCode", 32)
      .toUpperCase(),
    activityTemplateId: boundedParameter(
      searchParams,
      "activityTemplateId",
      160,
    ),
    installerId: boundedParameter(searchParams, "installerId", 160),
    technicianId: boundedParameter(searchParams, "technicianId", 160),
    status: boundedParameter(searchParams, "status", 64),
    postcode: boundedParameter(searchParams, "postcode", 16),
    query: boundedParameter(searchParams, "query", 200),
    sortBy: requestedSort as CreditexSyntheticRegisterSortKey,
    sortDirection: requestedDirection,
    page,
    pageSize,
  };
}

function escapedSearch(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function buildWhere(filters: CreditexSyntheticRegisterFilters) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  const equalityFilters: Array<
    [string, string]
  > = [
    ["source", filters.source],
    ["program_code", filters.programCode],
    ["activity_template_id", filters.activityTemplateId],
    ["installer_id", filters.installerId],
    ["technician_id", filters.technicianId],
    ["status_value", filters.status],
    ["postcode", filters.postcode],
  ];
  for (const [column, value] of equalityFilters) {
    if (!value) continue;
    conditions.push(`${column} = ?`);
    bindings.push(value);
  }

  if (filters.query) {
    conditions.push(`REPLACE(LOWER(
      COALESCE(app_id, '') || ' ' ||
      COALESCE(job_id, '') || ' ' ||
      COALESCE(status_cell, '') || ' ' ||
      COALESCE(sub_status, '') || ' ' ||
      COALESCE(type_cell, '') || ' ' ||
      COALESCE(work_type, '') || ' ' ||
      COALESCE(scheduled_datetime, '') || ' ' ||
      COALESCE(balance, '') || ' ' ||
      COALESCE(certificates, '') || ' ' ||
      COALESCE(submission, '') || ' ' ||
      COALESCE(invoiced, '') || ' ' ||
      COALESCE(field_worker, '') || ' ' ||
      COALESCE(agent, '') || ' ' ||
      COALESCE(client, '') || ' ' ||
      COALESCE(customer, '') || ' ' ||
      COALESCE(company_name, '') || ' ' ||
      COALESCE(ext_cust_ref, '') || ' ' ||
      COALESCE(phone, '') || ' ' ||
      COALESCE(mobile, '') || ' ' ||
      COALESCE(email, '') || ' ' ||
      COALESCE(address, '') || ' ' ||
      COALESCE(suburb, '') || ' ' ||
      COALESCE(postcode, '')
    ), '_', ' ') LIKE ? ESCAPE '\\'`);
    bindings.push(`%${escapedSearch(filters.query)}%`);
  }

  return {
    sql: conditions.length ? conditions.join(" AND ") : "1 = 1",
    bindings,
  };
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function projectCells(row: RegisterSqlRow): DataforceJobCsvRecord {
  return Object.fromEntries(
    DATAFORCE_JOB_CSV_HEADERS.map((header) => {
      const rawValue = stringValue(row[DATAFORCE_ROW_FIELDS[header]]);
      const value = (
        header === "Status"
        || header === "Submission"
        || header === "Invoiced"
      ) && rawValue
        ? readable(rawValue)
        : rawValue;
      return [header, value];
    }),
  ) as DataforceJobCsvRecord;
}

function projectRow(row: RegisterSqlRow): CreditexSyntheticRegisterRow {
  const source = stringValue(row.source) as CreditexSyntheticRegisterSource;
  const sourceId = stringValue(row.source_id);
  return {
    rowKey: `${source}:${sourceId}`,
    source,
    sourceId,
    recordMode: "synthetic_test",
    programCode: stringValue(row.program_code),
    activityTemplateId: stringValue(row.activity_template_id),
    installerId: stringValue(row.installer_id),
    technicianId: stringValue(row.technician_id),
    status: stringValue(row.status_value),
    revision: Number(row.revision || 1),
    updatedAt: stringValue(row.updated_at),
    cells: projectCells(row),
  };
}

function projectFacets(rows: FacetSqlRow[]) {
  const output = {
    sources: [] as CreditexSyntheticRegisterFacet[],
    programs: [] as CreditexSyntheticRegisterFacet[],
    activities: [] as CreditexSyntheticRegisterFacet[],
    installers: [] as CreditexSyntheticRegisterFacet[],
    technicians: [] as CreditexSyntheticRegisterFacet[],
    statuses: [] as CreditexSyntheticRegisterFacet[],
    postcodes: [] as CreditexSyntheticRegisterFacet[],
  };
  const collectionByFacet = {
    source: output.sources,
    program: output.programs,
    activity: output.activities,
    installer: output.installers,
    technician: output.technicians,
    status: output.statuses,
    postcode: output.postcodes,
  } as const;

  for (const row of rows) {
    const collection = collectionByFacet[
      row.facet as keyof typeof collectionByFacet
    ];
    if (!collection) continue;
    const value = stringValue(row.value);
    const rawLabel = stringValue(row.label) || value;
    collection.push({
      value,
      label: row.facet === "status" ? readable(rawLabel) : rawLabel,
      count: Number(row.option_count || 0),
      ...(row.parent_value
        ? { parentValue: stringValue(row.parent_value) }
        : {}),
    });
  }
  return output;
}

export async function loadCreditexSyntheticJobRegister(
  database: D1Database,
  member: ComplianceIdentity,
  filters: CreditexSyntheticRegisterFilters,
) {
  const where = buildWhere(filters);
  const sortExpression = SORT_EXPRESSIONS[filters.sortBy];
  const sortDirection = filters.sortDirection === "desc" ? "DESC" : "ASC";
  const organisationBindings = [
    member.organisationId,
    member.organisationId,
  ];

  const [totalRow, listResult, facetResults] = await Promise.all([
    database.prepare(`${REGISTER_CTE}
      SELECT COUNT(*) AS total
      FROM register_rows
      WHERE ${where.sql}`)
      .bind(...organisationBindings, ...where.bindings)
      .first<{ total: number }>(),
    database.prepare(`${REGISTER_CTE}
      SELECT *
      FROM register_rows
      WHERE ${where.sql}
      ORDER BY
        CASE WHEN ${sortExpression} = '' THEN 1 ELSE 0 END,
        ${sortExpression} COLLATE NOCASE ${sortDirection},
        source COLLATE NOCASE ASC,
        source_id COLLATE NOCASE ASC
      LIMIT ? OFFSET ?`)
      .bind(
        ...organisationBindings,
        ...where.bindings,
        filters.pageSize,
        filters.page * filters.pageSize,
      )
      .all<RegisterSqlRow>(),
    database.batch(FACET_QUERIES.map((facet) =>
      database.prepare(`${REGISTER_CTE}
        SELECT '${facet.facet}' AS facet,
          ${facet.value} AS value,
          ${facet.label} AS label,
          ${facet.parentValue} AS parent_value,
          COUNT(*) AS option_count
        FROM register_rows
        WHERE ${facet.value} <> ''
        GROUP BY ${facet.groupBy}
        ORDER BY label COLLATE NOCASE, value COLLATE NOCASE`)
        .bind(...organisationBindings)
    )),
  ]);

  const total = Number(totalRow?.total || 0);
  const pageCount = total
    ? Math.ceil(total / filters.pageSize)
    : 0;

  return {
    contractVersion: CREDITEX_SYNTHETIC_REGISTER_CONTRACT_VERSION,
    headers: [...DATAFORCE_JOB_CSV_HEADERS],
    rows: listResult.results.map(projectRow),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount,
      hasPreviousPage: filters.page > 0,
      hasNextPage: filters.page + 1 < pageCount,
    },
    facets: projectFacets(
      facetResults.flatMap(
        (result) => result.results as FacetSqlRow[],
      ),
    ),
    filters: {
      ...filters,
      sortKeys: Object.keys(
        SORT_EXPRESSIONS,
      ) as CreditexSyntheticRegisterSortKey[],
      pageSizes: Array.from(REGISTER_PAGE_SIZES),
    },
    boundaries: {
      recordMode: "synthetic_test" as const,
      accessMode: "read_only" as const,
      regulatedWrites: 0,
      externalSubmissionEnabled: false,
    },
  };
}
