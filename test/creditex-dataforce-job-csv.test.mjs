import test from "node:test";
import assert from "node:assert/strict";
import {
  DATAFORCE_CREDITEX_FIELD_MAPPINGS,
  DATAFORCE_JOB_CSV_HEADERS,
  DATAFORCE_JOB_CSV_LIMITS,
  DataforceJobCsvExportError,
  exportDataforceJobCsv,
  parseDataforceJobCsv,
  projectCreditexJobToDataforceRecord,
  projectDataforceRecordToCreditexJob,
  projectInstallerWorkOrderToDataforceRecord,
  validateDataforceJobCsv,
} from "../src/lib/creditex-dataforce-job-csv.ts";

function record(overrides = {}) {
  return {
    ...Object.fromEntries(
      DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, ""]),
    ),
    "App Id": "APP-100",
    "Job Id": "JOB-100",
    "Work Type": "Synthetic test activity",
    ...overrides,
  };
}

function rawCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function rawCsv(records, {
  headers = DATAFORCE_JOB_CSV_HEADERS,
  includeBom = true,
} = {}) {
  const rows = [
    headers.map(rawCell).join(","),
    ...records.map((item) => headers
      .map((header) => rawCell(item[header]))
      .join(",")),
  ];
  return `${includeBom ? "\uFEFF" : ""}${rows.join("\r\n")}\r\n`;
}

test("Dataforce job contract fixes the exact 23-column header order", () => {
  assert.equal(DATAFORCE_JOB_CSV_HEADERS.length, 23);
  assert.deepEqual(DATAFORCE_JOB_CSV_HEADERS, [
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
  ]);
  assert.deepEqual(
    DATAFORCE_CREDITEX_FIELD_MAPPINGS.map((mapping) => mapping.header),
    DATAFORCE_JOB_CSV_HEADERS,
  );
});

test("BOM and non-BOM Dataforce files validate without altering cell text", () => {
  const rows = [
    record({
      Customer: 'Synthetic, "Quoted" Customer',
      Address: "1 Example Street\r\nUnit 2",
    }),
  ];
  for (const includeBom of [true, false]) {
    const source = exportDataforceJobCsv(rows, { includeBom });
    const result = validateDataforceJobCsv(source);
    assert.equal(result.valid, true);
    assert.equal(result.summary.totalRows, 1);
    assert.equal(
      result.rows[0].record.Customer,
      'Synthetic, "Quoted" Customer',
    );
    assert.equal(
      result.rows[0].record.Address,
      "1 Example Street\r\nUnit 2",
    );
  }
});

test("a valid export has a deterministic round trip and Dataforce line endings", () => {
  const source = exportDataforceJobCsv([
    record({
      "App Id": "APP-200",
      "Job Id": "JOB-200",
      Email: "synthetic@example.invalid",
      Postcode: "3000",
    }),
    record({
      "App Id": "APP-201",
      "Job Id": "JOB-201",
      Customer: "Second synthetic customer",
    }),
  ]);
  assert.equal(source.startsWith("\uFEFF"), true);
  assert.equal(source.endsWith("\r\n"), true);
  assert.equal(/(?<!\r)\n/.test(source), false);

  const validation = validateDataforceJobCsv(source);
  assert.equal(validation.valid, true);
  const secondExport = exportDataforceJobCsv(
    validation.rows.map((row) => row.record),
  );
  assert.equal(secondExport, source);
});

test("validation rejects header additions, omissions, spelling and order changes", () => {
  const swapped = [...DATAFORCE_JOB_CSV_HEADERS];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  const result = validateDataforceJobCsv(rawCsv([record()], {
    headers: swapped,
  }));
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["CSV_HEADER_MISMATCH", "CSV_HEADER_MISMATCH"],
  );
  assert.equal(result.summary.acceptedRows, 0);

  const shortHeaders = DATAFORCE_JOB_CSV_HEADERS.slice(0, -1);
  const shortResult = validateDataforceJobCsv(rawCsv([record()], {
    headers: shortHeaders,
  }));
  assert.equal(shortResult.valid, false);
  assert.equal(
    shortResult.issues.some(
      (issue) => issue.code === "CSV_HEADER_COLUMN_COUNT",
    ),
    true,
  );
});

test("malformed quoting and blank rows fail closed with row-level issues", () => {
  const validRow = rawCsv([record()], { includeBom: false })
    .split("\r\n")[1];
  const malformed = `${DATAFORCE_JOB_CSV_HEADERS.join(",")}\r\n"open quote`;
  const malformedResult = validateDataforceJobCsv(malformed);
  assert.equal(malformedResult.valid, false);
  assert.equal(malformedResult.issues[0].code, "CSV_QUOTE_UNCLOSED");

  const withBlankRow =
    `${DATAFORCE_JOB_CSV_HEADERS.map(rawCell).join(",")}\r\n`
    + `${validRow}\r\n\r\n${validRow.replace("JOB-100", "JOB-101")}\r\n`;
  const blankResult = validateDataforceJobCsv(withBlankRow);
  assert.equal(blankResult.valid, false);
  assert.equal(
    blankResult.issues.some((issue) => issue.code === "CSV_BLANK_ROW"),
    true,
  );

  const shortRow = DATAFORCE_JOB_CSV_HEADERS.slice(0, -1)
    .map((header) => rawCell(record()[header]))
    .join(",");
  const rowWidthResult = validateDataforceJobCsv(
    `${DATAFORCE_JOB_CSV_HEADERS.map(rawCell).join(",")}\r\n${shortRow}\r\n`,
  );
  assert.equal(rowWidthResult.valid, false);
  assert.equal(rowWidthResult.issues[0].code, "CSV_ROW_COLUMN_COUNT");
});

test("duplicate Job Ids are normalized, bounded and safe to report", () => {
  const source = rawCsv([
    record({ "Job Id": "JOB-DUPLICATE" }),
    record({ "App Id": "APP-101", "Job Id": " job-duplicate " }),
    record({ "App Id": "APP-102", "Job Id": "JOB-EXISTING" }),
  ]);
  const result = validateDataforceJobCsv(source, {
    existingJobIds: new Set(["job-existing"]),
  });
  assert.equal(result.valid, false);
  assert.equal(result.summary.totalRows, 3);
  assert.equal(result.summary.acceptedRows, 1);
  assert.equal(result.summary.rejectedRows, 2);
  assert.equal(result.summary.duplicateRows, 2);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["DUPLICATE_JOB_ID", "JOB_ID_ALREADY_EXISTS"],
  );
  assert.equal(result.issues[0].firstRowNumber, 2);
  assert.equal(
    result.issues.some((issue) => JSON.stringify(issue).includes("JOB-")),
    false,
  );
});

test("validation bounds reported duplicate issues without accepting bad rows", () => {
  const rows = Array.from({ length: 300 }, (_, index) => record({
    "App Id": `APP-${index}`,
    "Job Id": "SAME-JOB-ID",
  }));
  const result = validateDataforceJobCsv(rawCsv(rows));
  assert.equal(result.valid, false);
  assert.equal(result.issues.length, 250);
  assert.equal(result.issuesTruncated, true);
  assert.equal(result.summary.duplicateRows, 299);
  assert.equal(result.summary.rejectedRows, 299);
  assert.equal(result.summary.acceptedRows, 1);
});

test("imports and exports enforce row and cell bounds", () => {
  const longRecord = record({
    Customer: "x".repeat(
      DATAFORCE_JOB_CSV_LIMITS.maximumCellCharacters + 1,
    ),
  });
  assert.throws(
    () => exportDataforceJobCsv([longRecord]),
    (error) => {
      assert.equal(error instanceof DataforceJobCsvExportError, true);
      assert.equal(error.issues[0].code, "CSV_CELL_TOO_LONG");
      return true;
    },
  );
  assert.equal(
    validateDataforceJobCsv(rawCsv([longRecord])).issues[0].code,
    "CSV_CELL_TOO_LONG",
  );

  const excessiveRows = Array.from(
    { length: DATAFORCE_JOB_CSV_LIMITS.maximumRows + 1 },
    (_, index) => record({ "Job Id": `JOB-${index}` }),
  );
  assert.throws(
    () => exportDataforceJobCsv(excessiveRows),
    (error) => {
      assert.equal(error instanceof DataforceJobCsvExportError, true);
      assert.equal(error.issues[0].code, "CSV_TOO_MANY_ROWS");
      return true;
    },
  );
  assert.equal(
    validateDataforceJobCsv(rawCsv(excessiveRows)).issues[0].code,
    "CSV_TOO_MANY_ROWS",
  );

  assert.throws(
    () => exportDataforceJobCsv([record({ Customer: "null\u0000cell" })]),
    (error) => {
      assert.equal(error instanceof DataforceJobCsvExportError, true);
      assert.equal(error.issues[0].code, "SOURCE_CONTAINS_NUL");
      return true;
    },
  );
});

test("export neutralizes spreadsheet formulas in every dangerous form", () => {
  const source = exportDataforceJobCsv([
    record({
      Customer: "=2+2",
      "Company Name": " +SUM(A1:A2)",
      Phone: "-1+2",
      Mobile: "@command",
      Address: "\t=cmd",
    }),
  ]);
  const parsed = parseDataforceJobCsv(source);
  const parsedRecord = Object.fromEntries(
    DATAFORCE_JOB_CSV_HEADERS.map((header, index) => [
      header,
      parsed.rows[0].values[index],
    ]),
  );
  assert.equal(parsedRecord.Customer, "'=2+2");
  assert.equal(parsedRecord["Company Name"], "' +SUM(A1:A2)");
  assert.equal(parsedRecord.Phone, "'-1+2");
  assert.equal(parsedRecord.Mobile, "'@command");
  assert.equal(parsedRecord.Address, "'\t=cmd");
});

test("Creditex job projection fills evidenced fields and leaves taxonomies explicit", () => {
  const projected = projectCreditexJobToDataforceRecord({
    caseNumber: "CASE-1",
    jobNumber: "JOB-1",
    work: {
      workType: "Synthetic work type",
      scheduledStart: "2026-08-02T09:00:00+10:00",
    },
    appointment: {
      id: "APP-1",
      startsAt: "2026-08-03T10:00:00+10:00",
    },
    crm: {
      customerReference: "SYNTHETIC-REF",
      invoicedValueCents: 42_000,
      paidValueCents: 10_000,
    },
    customer: {
      firstName: "Test",
      lastName: "Customer",
      businessName: "Synthetic Company",
      email: "test@example.invalid",
      phone: "0400 000 000",
    },
    site: {
      addressLine1: "1 Example Street",
      addressLine2: "Unit 2",
      suburb: "Melbourne",
      postcode: "3000",
    },
    technician: {
      displayName: "Synthetic Technician",
    },
  }, {
    Status: "Approved mapping value",
  });

  assert.equal(projected["App Id"], "APP-1");
  assert.equal(projected["Job Id"], "JOB-1");
  assert.equal(projected.Status, "Approved mapping value");
  assert.equal(projected.SubStatus, "");
  assert.equal(
    projected["Scheduled Datetime"],
    "2026-08-03T10:00:00+10:00",
  );
  assert.equal(projected.Balance, "$ 320.00");
  assert.equal(projected.Customer, "Test Customer");
  assert.equal(projected.Phone, "0400 000 000");
  assert.equal(projected.Mobile, "");
  assert.equal(projected.Address, "1 Example Street, Unit 2");
});

test("Creditex job export leaves a missing Dataforce App Id blank", () => {
  const projected = projectCreditexJobToDataforceRecord({
    caseNumber: "CASE-7",
    jobNumber: "JOB-7",
    appointment: null,
  });

  assert.equal(projected["App Id"], "");
  assert.equal(projected["Job Id"], "JOB-7");
});

test("installer work-order projection produces one exact Dataforce register record", () => {
  const projected = projectInstallerWorkOrderToDataforceRecord({
    identifiers: {
      appointmentId: " APP-INSTALL-1 ",
      jobId: " JOB-INSTALL-1 ",
    },
    work: {
      workType: "Water heating",
      scheduledStart: "2026-08-04T08:00:00+10:00",
    },
    appointment: {
      startsAt: "2026-08-04T09:30:00+10:00",
    },
    financials: {
      invoicedValueCents: 350_000,
      paidValueCents: 125_000,
      invoiceStatus: "Part paid",
    },
    customer: {
      firstName: "Test",
      lastName: "Installer Customer",
      businessName: "Test Customer Company",
      phone: "03 9000 0000",
      mobile: "0400 000 000",
      email: "installer-customer@example.invalid",
    },
    serviceSite: {
      addressLine1: "18 Example Road",
      addressLine2: "Unit 4",
      suburb: "Melbourne",
      postcode: "3000",
    },
    technician: {
      displayName: "Test Field Technician",
    },
    customerReference: "CUSTOMER-REF-1",
    verifiedCertificateIssuance: {
      basis: "verified-case-issuance",
      quantity: 5,
    },
  });

  assert.deepEqual(Object.keys(projected), DATAFORCE_JOB_CSV_HEADERS);
  assert.equal(projected["App Id"], "APP-INSTALL-1");
  assert.equal(projected["Job Id"], "JOB-INSTALL-1");
  assert.equal(projected["Work Type"], "Water heating");
  assert.equal(
    projected["Scheduled Datetime"],
    "2026-08-04T09:30:00+10:00",
  );
  assert.equal(projected.Balance, "$ 2250.00");
  assert.equal(projected["Certificates (VEECs)"], "5");
  assert.equal(projected.Invoiced, "Part paid");
  assert.equal(projected["Field Worker"], "Test Field Technician");
  assert.equal(projected.Customer, "Test Installer Customer");
  assert.equal(projected["Company Name"], "Test Customer Company");
  assert.equal(projected["Ext Cust Ref"], "CUSTOMER-REF-1");
  assert.equal(projected.Phone, "03 9000 0000");
  assert.equal(projected.Mobile, "0400 000 000");
  assert.equal(projected.Email, "installer-customer@example.invalid");
  assert.equal(projected.Address, "18 Example Road, Unit 4");
  assert.equal(projected.Suburb, "Melbourne");
  assert.equal(projected.Postcode, "3000");
});

test("installer work-order projection leaves unresolved semantics and unverified certificates blank", () => {
  const projected = projectInstallerWorkOrderToDataforceRecord({
    identifiers: {
      appointmentId: null,
      jobId: "JOB-INSTALL-2",
    },
    work: {
      scheduledStart: "2026-08-05T10:00:00+10:00",
    },
    appointment: null,
    financials: {
      invoicedValueCents: null,
      paidValueCents: null,
      invoiceStatus: null,
    },
    customer: {
      firstName: null,
      lastName: null,
      businessName: "Fallback Customer Company",
      phone: null,
      mobile: null,
    },
    serviceSite: {
      addressLine1: null,
      addressLine2: null,
      suburb: null,
      postcode: null,
    },
    verifiedCertificateIssuance: {
      basis: "batch-apportionment",
      quantity: 7.5,
    },
  });

  assert.equal(projected["App Id"], "");
  assert.equal(projected["Job Id"], "JOB-INSTALL-2");
  assert.equal(
    projected["Scheduled Datetime"],
    "2026-08-05T10:00:00+10:00",
  );
  assert.equal(projected.Customer, "Fallback Customer Company");
  assert.equal(projected.Balance, "");
  assert.equal(projected.Invoiced, "");
  assert.equal(projected["Certificates (VEECs)"], "");
  for (const header of [
    "Status",
    "SubStatus",
    "Type",
    "Submission",
    "Agent",
    "Client",
  ]) {
    assert.equal(projected[header], "");
  }
  assert.equal(projected.Address, "");
  assert.equal(projected.Suburb, "");
  assert.equal(projected.Postcode, "");
  assert.equal(projected.Phone, "");
  assert.equal(projected.Mobile, "");
});

test("Dataforce import projection preserves unresolved fields for review", () => {
  const sourceRecord = record({
    Status: "Synthetic status",
    SubStatus: "Synthetic substatus",
    Type: "Synthetic type",
    "Scheduled Datetime": "02-Aug-2026 9:00AM",
    "Field Worker": "Synthetic Technician",
    Agent: "Synthetic Agent",
    Client: "Synthetic Client",
    Customer: "Synthetic Customer",
    "Company Name": "Synthetic Company",
    "Ext Cust Ref": "SYNTHETIC-REF",
    Phone: "03 9000 0000",
    Mobile: "0400 000 000",
    Email: "synthetic@example.invalid",
    Address: "1 Example Street",
    Suburb: "Melbourne",
    Postcode: "3000",
  });
  const projection = projectDataforceRecordToCreditexJob(sourceRecord);

  assert.equal(projection.appointment.externalApplicationId, "APP-100");
  assert.equal(projection.jobNumber, "JOB-100");
  assert.equal(
    projection.appointment.startsAtSourceValue,
    "02-Aug-2026 9:00AM",
  );
  assert.equal(projection.customer.phone, "0400 000 000");
  assert.equal(projection.technician.displayName, "Synthetic Technician");
  assert.equal(
    projection.unmappedDataforceValues.status,
    "Synthetic status",
  );
  assert.equal(
    projection.unmappedDataforceValues.agent,
    "Synthetic Agent",
  );
});
