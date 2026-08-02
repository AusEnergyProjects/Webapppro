export const DATAFORCE_JOB_CSV_HEADERS = Object.freeze([
  "App Id",
  "Job Id",
  "Status",
  "SubStatus",
  "Type",
  "Work Type",
  "Scheduled Datetime",
  "Balance",
  "Certificates (VEECs)",
  "Submission",
  "Invoiced",
  "Field Worker",
  "Agent",
  "Client",
  "Customer",
  "Company Name",
  "Ext Cust Ref",
  "Phone",
  "Mobile",
  "Email",
  "Address",
  "Suburb",
  "Postcode",
] as const);

export type DataforceJobCsvHeader =
  typeof DATAFORCE_JOB_CSV_HEADERS[number];

export type DataforceJobCsvRecord = Record<DataforceJobCsvHeader, string>;

export const DATAFORCE_JOB_CSV_LIMITS = Object.freeze({
  maximumSourceBytes: 10 * 1024 * 1024,
  maximumRows: 20_000,
  maximumCellCharacters: 4_096,
  maximumReportedIssues: 250,
});

export type DataforceJobCsvIssueCode =
  | "SOURCE_TYPE_INVALID"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_CONTAINS_NUL"
  | "CSV_UNEXPECTED_QUOTE"
  | "CSV_TRAILING_CHARACTER_AFTER_QUOTE"
  | "CSV_QUOTE_UNCLOSED"
  | "CSV_TOO_MANY_COLUMNS"
  | "CSV_CELL_TOO_LONG"
  | "CSV_TOO_MANY_ROWS"
  | "CSV_EMPTY"
  | "CSV_HEADER_COLUMN_COUNT"
  | "CSV_HEADER_MISMATCH"
  | "CSV_NO_DATA_ROWS"
  | "CSV_BLANK_ROW"
  | "CSV_ROW_COLUMN_COUNT"
  | "JOB_ID_REQUIRED"
  | "DUPLICATE_JOB_ID"
  | "JOB_ID_ALREADY_EXISTS";

export type DataforceJobCsvIssue = {
  code: DataforceJobCsvIssueCode;
  message: string;
  rowNumber?: number;
  columnNumber?: number;
  header?: DataforceJobCsvHeader;
  firstRowNumber?: number;
};

export type ParsedDataforceJobCsvRow = {
  rowNumber: number;
  values: readonly string[];
};

export type ParsedDataforceJobCsv = {
  headers: readonly string[];
  rows: readonly ParsedDataforceJobCsvRow[];
};

export type ValidatedDataforceJobCsvRow = {
  rowNumber: number;
  record: DataforceJobCsvRecord;
};

export type DataforceJobCsvValidation = {
  valid: boolean;
  headers: readonly string[];
  rows: readonly ValidatedDataforceJobCsvRow[];
  issues: readonly DataforceJobCsvIssue[];
  issuesTruncated: boolean;
  summary: {
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    duplicateRows: number;
  };
};

export type DataforceCreditexFieldMapping = {
  header: DataforceJobCsvHeader;
  creditexPath: string | null;
  mode: "direct" | "derived" | "unmapped";
  note: string;
};

export const DATAFORCE_CREDITEX_FIELD_MAPPINGS = Object.freeze([
  {
    header: "App Id",
    creditexPath: "appointment.id",
    mode: "direct",
    note: "External Dataforce appointment/application identifier.",
  },
  {
    header: "Job Id",
    creditexPath: "jobNumber",
    mode: "direct",
    note: "External Dataforce job identifier and import duplicate key.",
  },
  {
    header: "Status",
    creditexPath: null,
    mode: "unmapped",
    note: "Dataforce lifecycle values are not equivalent to a Creditex review state.",
  },
  {
    header: "SubStatus",
    creditexPath: null,
    mode: "unmapped",
    note: "Requires an approved lifecycle-value mapping.",
  },
  {
    header: "Type",
    creditexPath: null,
    mode: "unmapped",
    note: "Requires an approved Dataforce type mapping.",
  },
  {
    header: "Work Type",
    creditexPath: "work.workType",
    mode: "direct",
    note: "Current Creditex pilot jobs expose the work type.",
  },
  {
    header: "Scheduled Datetime",
    creditexPath: "appointment.startsAt",
    mode: "derived",
    note: "The Dataforce local display value must be normalised before persistence.",
  },
  {
    header: "Balance",
    creditexPath: "crm.invoicedValueCents - crm.paidValueCents",
    mode: "derived",
    note: "Creditex stores invoice and payment totals rather than a balance string.",
  },
  {
    header: "Certificates (VEECs)",
    creditexPath: null,
    mode: "unmapped",
    note: "No issued-certificate count exists in the synthetic Creditex pilot.",
  },
  {
    header: "Submission",
    creditexPath: null,
    mode: "unmapped",
    note: "Dataforce submission values require an approved connector-state mapping.",
  },
  {
    header: "Invoiced",
    creditexPath: "crm.invoiceStatus",
    mode: "derived",
    note: "The Dataforce display value and Creditex invoice-state taxonomy differ.",
  },
  {
    header: "Field Worker",
    creditexPath: "technician.displayName",
    mode: "direct",
    note: "Current Creditex jobs expose the assigned technician display name.",
  },
  {
    header: "Agent",
    creditexPath: null,
    mode: "unmapped",
    note: "Agent ownership must be reconciled to an authorised Creditex account.",
  },
  {
    header: "Client",
    creditexPath: null,
    mode: "unmapped",
    note: "Client values require an approved tenant mapping.",
  },
  {
    header: "Customer",
    creditexPath: "customer.firstName + customer.lastName",
    mode: "derived",
    note: "Creditex stores customer name components separately.",
  },
  {
    header: "Company Name",
    creditexPath: "customer.businessName",
    mode: "direct",
    note: "Current Creditex jobs expose the customer business name.",
  },
  {
    header: "Ext Cust Ref",
    creditexPath: "crm.customerReference",
    mode: "direct",
    note: "Current Creditex CRM details expose an external customer reference.",
  },
  {
    header: "Phone",
    creditexPath: "customer.phone",
    mode: "derived",
    note: "Creditex currently has one customer phone field; import prefers Mobile then Phone.",
  },
  {
    header: "Mobile",
    creditexPath: "customer.phone",
    mode: "derived",
    note: "Creditex currently has one customer phone field; import prefers Mobile then Phone.",
  },
  {
    header: "Email",
    creditexPath: "customer.email",
    mode: "direct",
    note: "Current Creditex jobs expose the customer email.",
  },
  {
    header: "Address",
    creditexPath: "site.addressLine1 + site.addressLine2",
    mode: "derived",
    note: "Creditex stores address lines separately.",
  },
  {
    header: "Suburb",
    creditexPath: "site.suburb",
    mode: "direct",
    note: "Current Creditex jobs expose the service-site suburb.",
  },
  {
    header: "Postcode",
    creditexPath: "site.postcode",
    mode: "direct",
    note: "Current Creditex jobs expose the service-site postcode.",
  },
] as const satisfies readonly DataforceCreditexFieldMapping[]);

type CsvState = "field_start" | "unquoted" | "quoted" | "after_quote";

class DataforceJobCsvContractError extends Error {
  readonly issue: DataforceJobCsvIssue;

  constructor(issue: DataforceJobCsvIssue) {
    super(issue.message);
    this.name = "DataforceJobCsvContractError";
    this.issue = issue;
  }
}

export class DataforceJobCsvExportError extends Error {
  readonly issues: readonly DataforceJobCsvIssue[];

  constructor(issues: readonly DataforceJobCsvIssue[]) {
    super("The Dataforce job CSV export did not satisfy its contract.");
    this.name = "DataforceJobCsvExportError";
    this.issues = issues;
  }
}

function sourceByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function contractError(
  code: DataforceJobCsvIssueCode,
  message: string,
  rowNumber?: number,
  columnNumber?: number,
): never {
  throw new DataforceJobCsvContractError({
    code,
    message,
    rowNumber,
    columnNumber,
  });
}

function parseCsvMatrix(source: string) {
  if (typeof source !== "string") {
    contractError("SOURCE_TYPE_INVALID", "CSV source must be text.");
  }
  if (sourceByteLength(source) > DATAFORCE_JOB_CSV_LIMITS.maximumSourceBytes) {
    contractError(
      "SOURCE_TOO_LARGE",
      "CSV source exceeds the maximum supported byte size.",
    );
  }
  const input = source.replace(/^\uFEFF/, "");
  if (input.includes("\u0000")) {
    contractError(
      "SOURCE_CONTAINS_NUL",
      "CSV source contains a null character.",
    );
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: CsvState = "field_start";
  let recordStarted = false;
  let physicalLine = 1;

  const currentRowNumber = () => rows.length + 1;
  const currentColumnNumber = () => row.length + 1;

  const append = (value: string) => {
    field += value;
    recordStarted = true;
    if (
      field.length > DATAFORCE_JOB_CSV_LIMITS.maximumCellCharacters
    ) {
      contractError(
        "CSV_CELL_TOO_LONG",
        "CSV cell exceeds the maximum supported character count.",
        currentRowNumber(),
        currentColumnNumber(),
      );
    }
  };

  const finishField = () => {
    if (row.length >= DATAFORCE_JOB_CSV_HEADERS.length) {
      contractError(
        "CSV_TOO_MANY_COLUMNS",
        "CSV row contains more than 23 columns.",
        currentRowNumber(),
        currentColumnNumber(),
      );
    }
    row.push(field);
    field = "";
    state = "field_start";
  };

  const finishRow = () => {
    finishField();
    rows.push(row);
    if (rows.length > DATAFORCE_JOB_CSV_LIMITS.maximumRows + 1) {
      contractError(
        "CSV_TOO_MANY_ROWS",
        "CSV contains more than the supported number of data rows.",
        rows.length,
      );
    }
    row = [];
    recordStarted = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (state === "quoted") {
      if (character === '"') {
        if (input[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          state = "after_quote";
        }
      } else if (character === "\r" && input[index + 1] === "\n") {
        append("\r\n");
        physicalLine += 1;
        index += 1;
      } else {
        append(character);
        if (character === "\r" || character === "\n") {
          physicalLine += 1;
        }
      }
      continue;
    }

    if (state === "after_quote") {
      if (character === ",") {
        finishField();
        recordStarted = true;
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && input[index + 1] === "\n") {
          index += 1;
        }
        finishRow();
        physicalLine += 1;
      } else {
        contractError(
          "CSV_TRAILING_CHARACTER_AFTER_QUOTE",
          `CSV contains an unexpected character after a closing quote near physical line ${physicalLine}.`,
          currentRowNumber(),
          currentColumnNumber(),
        );
      }
      continue;
    }

    if (character === ",") {
      finishField();
      recordStarted = true;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
      physicalLine += 1;
    } else if (character === '"') {
      if (state === "unquoted" || field.length > 0) {
        contractError(
          "CSV_UNEXPECTED_QUOTE",
          `CSV contains an unexpected quote near physical line ${physicalLine}.`,
          currentRowNumber(),
          currentColumnNumber(),
        );
      }
      state = "quoted";
      recordStarted = true;
    } else {
      state = "unquoted";
      append(character);
    }
  }

  if (state === "quoted") {
    contractError(
      "CSV_QUOTE_UNCLOSED",
      "CSV contains an unclosed quoted field.",
      currentRowNumber(),
      currentColumnNumber(),
    );
  }
  if (recordStarted || row.length > 0 || field.length > 0) {
    finishRow();
  }
  return rows;
}

export function parseDataforceJobCsv(
  source: string,
): ParsedDataforceJobCsv {
  const rows = parseCsvMatrix(source);
  return {
    headers: rows[0] || [],
    rows: rows.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      values,
    })),
  };
}

function emptyDataforceRecord(): DataforceJobCsvRecord {
  return Object.fromEntries(
    DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, ""]),
  ) as DataforceJobCsvRecord;
}

function recordFromValues(values: readonly string[]) {
  const record = emptyDataforceRecord();
  for (let index = 0; index < DATAFORCE_JOB_CSV_HEADERS.length; index += 1) {
    record[DATAFORCE_JOB_CSV_HEADERS[index]] = values[index] ?? "";
  }
  return record;
}

function normalizedJobId(value: string) {
  return value.trim().toUpperCase();
}

function appendIssue(
  issues: DataforceJobCsvIssue[],
  issue: DataforceJobCsvIssue,
) {
  if (issues.length < DATAFORCE_JOB_CSV_LIMITS.maximumReportedIssues) {
    issues.push(issue);
  }
}

export function validateDataforceJobCsv(
  source: string,
  options: {
    existingJobIds?: Iterable<string>;
  } = {},
): DataforceJobCsvValidation {
  let parsed: ParsedDataforceJobCsv;
  try {
    parsed = parseDataforceJobCsv(source);
  } catch (error) {
    if (!(error instanceof DataforceJobCsvContractError)) {
      throw error;
    }
    return {
      valid: false,
      headers: [],
      rows: [],
      issues: [error.issue],
      issuesTruncated: false,
      summary: {
        totalRows: 0,
        acceptedRows: 0,
        rejectedRows: 0,
        duplicateRows: 0,
      },
    };
  }

  const issues: DataforceJobCsvIssue[] = [];
  let totalIssueCount = 0;
  const report = (issue: DataforceJobCsvIssue) => {
    totalIssueCount += 1;
    appendIssue(issues, issue);
  };

  if (parsed.headers.length === 0) {
    report({
      code: "CSV_EMPTY",
      message: "CSV must contain the Dataforce job header row.",
      rowNumber: 1,
    });
  } else if (parsed.headers.length !== DATAFORCE_JOB_CSV_HEADERS.length) {
    report({
      code: "CSV_HEADER_COLUMN_COUNT",
      message: "CSV header must contain exactly 23 columns.",
      rowNumber: 1,
    });
  }

  const comparableHeaderCount = Math.min(
    parsed.headers.length,
    DATAFORCE_JOB_CSV_HEADERS.length,
  );
  for (let index = 0; index < comparableHeaderCount; index += 1) {
    if (parsed.headers[index] !== DATAFORCE_JOB_CSV_HEADERS[index]) {
      report({
        code: "CSV_HEADER_MISMATCH",
        message:
          `CSV column ${index + 1} must be "${DATAFORCE_JOB_CSV_HEADERS[index]}".`,
        rowNumber: 1,
        columnNumber: index + 1,
        header: DATAFORCE_JOB_CSV_HEADERS[index],
      });
    }
  }

  if (parsed.rows.length === 0) {
    report({
      code: "CSV_NO_DATA_ROWS",
      message: "CSV must contain at least one Dataforce job row.",
    });
  }

  const headerIsExact =
    parsed.headers.length === DATAFORCE_JOB_CSV_HEADERS.length
    && DATAFORCE_JOB_CSV_HEADERS.every(
      (header, index) => parsed.headers[index] === header,
    );
  const existingJobIds = new Set(
    Array.from(options.existingJobIds || [], normalizedJobId).filter(Boolean),
  );
  const firstRowsByJobId = new Map<string, number>();
  const rejectedRows = new Set<number>();
  const duplicateRows = new Set<number>();
  const rows: ValidatedDataforceJobCsvRow[] = [];

  for (const parsedRow of parsed.rows) {
    if (parsedRow.values.every((value) => value.trim() === "")) {
      rejectedRows.add(parsedRow.rowNumber);
      report({
        code: "CSV_BLANK_ROW",
        message: "Blank rows are not permitted inside a Dataforce job CSV.",
        rowNumber: parsedRow.rowNumber,
      });
      continue;
    }
    if (parsedRow.values.length !== DATAFORCE_JOB_CSV_HEADERS.length) {
      rejectedRows.add(parsedRow.rowNumber);
      report({
        code: "CSV_ROW_COLUMN_COUNT",
        message: "Dataforce job rows must contain exactly 23 columns.",
        rowNumber: parsedRow.rowNumber,
      });
      continue;
    }
    if (!headerIsExact) {
      rejectedRows.add(parsedRow.rowNumber);
      continue;
    }

    const record = recordFromValues(parsedRow.values);
    rows.push({ rowNumber: parsedRow.rowNumber, record });
    const jobId = normalizedJobId(record["Job Id"]);
    if (!jobId) {
      rejectedRows.add(parsedRow.rowNumber);
      report({
        code: "JOB_ID_REQUIRED",
        message: "Job Id is required for every Dataforce job row.",
        rowNumber: parsedRow.rowNumber,
        columnNumber: 2,
        header: "Job Id",
      });
      continue;
    }
    const firstRowNumber = firstRowsByJobId.get(jobId);
    if (firstRowNumber !== undefined) {
      duplicateRows.add(parsedRow.rowNumber);
      rejectedRows.add(parsedRow.rowNumber);
      report({
        code: "DUPLICATE_JOB_ID",
        message: "Job Id duplicates an earlier row in this CSV.",
        rowNumber: parsedRow.rowNumber,
        columnNumber: 2,
        header: "Job Id",
        firstRowNumber,
      });
    } else {
      firstRowsByJobId.set(jobId, parsedRow.rowNumber);
    }
    if (existingJobIds.has(jobId)) {
      duplicateRows.add(parsedRow.rowNumber);
      rejectedRows.add(parsedRow.rowNumber);
      report({
        code: "JOB_ID_ALREADY_EXISTS",
        message: "Job Id already exists in the target Creditex workspace.",
        rowNumber: parsedRow.rowNumber,
        columnNumber: 2,
        header: "Job Id",
      });
    }
  }

  const structurallyAcceptedRows = rows.filter(
    (row) => !rejectedRows.has(row.rowNumber),
  ).length;
  return {
    valid: totalIssueCount === 0,
    headers: parsed.headers,
    rows,
    issues,
    issuesTruncated:
      totalIssueCount > DATAFORCE_JOB_CSV_LIMITS.maximumReportedIssues,
    summary: {
      totalRows: parsed.rows.length,
      acceptedRows: structurallyAcceptedRows,
      rejectedRows: rejectedRows.size,
      duplicateRows: duplicateRows.size,
    },
  };
}

type DataforceCsvCell =
  | string
  | number
  | boolean
  | null
  | undefined;

function formulaSafeText(value: DataforceCsvCell) {
  const text = value === null || value === undefined ? "" : String(value);
  return /^(?:[\u0001-\u0020]*[=+\-@]|\t|\r|\n)/.test(text)
    ? `'${text}`
    : text;
}

function quotedCsvCell(value: DataforceCsvCell) {
  return `"${formulaSafeText(value).replaceAll('"', '""')}"`;
}

function exportValidationIssues(
  records: readonly Partial<DataforceJobCsvRecord>[],
) {
  const issues: DataforceJobCsvIssue[] = [];
  if (records.length === 0) {
    issues.push({
      code: "CSV_NO_DATA_ROWS",
      message: "At least one Dataforce job row is required for export.",
    });
  }
  if (records.length > DATAFORCE_JOB_CSV_LIMITS.maximumRows) {
    issues.push({
      code: "CSV_TOO_MANY_ROWS",
      message: "CSV contains more than the supported number of data rows.",
    });
    return issues;
  }

  const firstRowsByJobId = new Map<string, number>();
  for (let index = 0; index < records.length; index += 1) {
    const rowNumber = index + 2;
    const record = records[index];
    for (let column = 0; column < DATAFORCE_JOB_CSV_HEADERS.length; column += 1) {
      const header = DATAFORCE_JOB_CSV_HEADERS[column];
      const value = record[header];
      const text = value === null || value === undefined ? "" : String(value);
      if (text.includes("\u0000")) {
        appendIssue(issues, {
          code: "SOURCE_CONTAINS_NUL",
          message: "CSV cells cannot contain a null character.",
          rowNumber,
          columnNumber: column + 1,
          header,
        });
      }
      if (text.length > DATAFORCE_JOB_CSV_LIMITS.maximumCellCharacters) {
        appendIssue(issues, {
          code: "CSV_CELL_TOO_LONG",
          message: "CSV cell exceeds the maximum supported character count.",
          rowNumber,
          columnNumber: column + 1,
          header,
        });
      }
    }
    const jobId = normalizedJobId(String(record["Job Id"] ?? ""));
    if (!jobId) {
      appendIssue(issues, {
        code: "JOB_ID_REQUIRED",
        message: "Job Id is required for every Dataforce job row.",
        rowNumber,
        columnNumber: 2,
        header: "Job Id",
      });
      continue;
    }
    const firstRowNumber = firstRowsByJobId.get(jobId);
    if (firstRowNumber !== undefined) {
      appendIssue(issues, {
        code: "DUPLICATE_JOB_ID",
        message: "Job Id duplicates an earlier row in this CSV.",
        rowNumber,
        columnNumber: 2,
        header: "Job Id",
        firstRowNumber,
      });
    } else {
      firstRowsByJobId.set(jobId, rowNumber);
    }
  }
  return issues;
}

export function exportDataforceJobCsv(
  records: readonly Partial<DataforceJobCsvRecord>[],
  options: {
    includeBom?: boolean;
  } = {},
) {
  const issues = exportValidationIssues(records);
  if (issues.length > 0) {
    throw new DataforceJobCsvExportError(issues);
  }

  const lines = [
    DATAFORCE_JOB_CSV_HEADERS.map(quotedCsvCell).join(","),
    ...records.map((record) => DATAFORCE_JOB_CSV_HEADERS
      .map((header) => quotedCsvCell(record[header]))
      .join(",")),
  ];
  const output = `${options.includeBom === false ? "" : "\uFEFF"}${lines.join("\r\n")}\r\n`;
  if (
    sourceByteLength(output)
    > DATAFORCE_JOB_CSV_LIMITS.maximumSourceBytes
  ) {
    throw new DataforceJobCsvExportError([{
      code: "SOURCE_TOO_LARGE",
      message: "CSV export exceeds the maximum supported byte size.",
    }]);
  }
  return output;
}

export type CreditexDataforceProjectionJob = {
  caseNumber?: string | null;
  jobNumber: string;
  work?: {
    workType?: string | null;
    scheduledStart?: string | null;
  } | null;
  appointment?: {
    id?: string | null;
    startsAt?: string | null;
  } | null;
  crm?: {
    customerReference?: string | null;
    invoicedValueCents?: number | null;
    paidValueCents?: number | null;
  } | null;
  customer?: {
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  site?: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    suburb?: string | null;
    postcode?: string | null;
  } | null;
  technician?: {
    displayName?: string | null;
  } | null;
};

function value(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function customerDisplayName(
  customer: CreditexDataforceProjectionJob["customer"],
) {
  const personName = [
    value(customer?.firstName).trim(),
    value(customer?.lastName).trim(),
  ].filter(Boolean).join(" ");
  return personName || value(customer?.businessName);
}

function addressDisplay(
  site: CreditexDataforceProjectionJob["site"],
) {
  return [
    value(site?.addressLine1).trim(),
    value(site?.addressLine2).trim(),
  ].filter(Boolean).join(", ");
}

function balanceDisplay(
  crm: CreditexDataforceProjectionJob["crm"],
) {
  if (
    typeof crm?.invoicedValueCents !== "number"
    && typeof crm?.paidValueCents !== "number"
  ) {
    return "";
  }
  const invoiced = Number.isFinite(crm?.invoicedValueCents)
    ? Number(crm?.invoicedValueCents)
    : 0;
  const paid = Number.isFinite(crm?.paidValueCents)
    ? Number(crm?.paidValueCents)
    : 0;
  return `$ ${((invoiced - paid) / 100).toFixed(2)}`;
}

export function projectCreditexJobToDataforceRecord(
  job: CreditexDataforceProjectionJob,
  overrides: Partial<DataforceJobCsvRecord> = {},
): DataforceJobCsvRecord {
  return {
    ...emptyDataforceRecord(),
    "App Id": value(job.appointment?.id),
    "Job Id": value(job.jobNumber),
    "Work Type": value(job.work?.workType),
    "Scheduled Datetime": value(
      job.appointment?.startsAt || job.work?.scheduledStart,
    ),
    "Balance": balanceDisplay(job.crm),
    "Field Worker": value(job.technician?.displayName),
    "Customer": customerDisplayName(job.customer),
    "Company Name": value(job.customer?.businessName),
    "Ext Cust Ref": value(job.crm?.customerReference),
    "Phone": value(job.customer?.phone),
    "Email": value(job.customer?.email),
    "Address": addressDisplay(job.site),
    "Suburb": value(job.site?.suburb),
    "Postcode": value(job.site?.postcode),
    ...Object.fromEntries(
      DATAFORCE_JOB_CSV_HEADERS
        .filter((header) => Object.hasOwn(overrides, header))
        .map((header) => [header, value(overrides[header])]),
    ),
  };
}

export type DataforceCreditexImportProjection = {
  source: {
    system: "dataforce";
    applicationId: string;
    jobId: string;
  };
  jobNumber: string;
  work: {
    workType: string;
  };
  appointment: {
    externalApplicationId: string;
    startsAtSourceValue: string;
  };
  crm: {
    customerReference: string;
  };
  customer: {
    displayNameSourceValue: string;
    businessName: string;
    email: string;
    phone: string;
  };
  site: {
    addressLine1: string;
    suburb: string;
    postcode: string;
  };
  technician: {
    displayName: string;
  };
  unmappedDataforceValues: {
    status: string;
    subStatus: string;
    type: string;
    balance: string;
    certificateCount: string;
    submission: string;
    invoiced: string;
    agent: string;
    client: string;
    phone: string;
    mobile: string;
  };
};

export function projectDataforceRecordToCreditexJob(
  record: DataforceJobCsvRecord,
): DataforceCreditexImportProjection {
  return {
    source: {
      system: "dataforce",
      applicationId: record["App Id"],
      jobId: record["Job Id"],
    },
    jobNumber: record["Job Id"],
    work: {
      workType: record["Work Type"],
    },
    appointment: {
      externalApplicationId: record["App Id"],
      startsAtSourceValue: record["Scheduled Datetime"],
    },
    crm: {
      customerReference: record["Ext Cust Ref"],
    },
    customer: {
      displayNameSourceValue: record.Customer,
      businessName: record["Company Name"],
      email: record.Email,
      phone: record.Mobile || record.Phone,
    },
    site: {
      addressLine1: record.Address,
      suburb: record.Suburb,
      postcode: record.Postcode,
    },
    technician: {
      displayName: record["Field Worker"],
    },
    unmappedDataforceValues: {
      status: record.Status,
      subStatus: record.SubStatus,
      type: record.Type,
      balance: record.Balance,
      certificateCount: record["Certificates (VEECs)"],
      submission: record.Submission,
      invoiced: record.Invoiced,
      agent: record.Agent,
      client: record.Client,
      phone: record.Phone,
      mobile: record.Mobile,
    },
  };
}
