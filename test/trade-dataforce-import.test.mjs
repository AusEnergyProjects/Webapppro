import assert from "node:assert/strict";
import test from "node:test";
import {
  DATAFORCE_JOB_CSV_HEADERS,
  validateDataforceJobCsv,
} from "../src/lib/creditex-dataforce-job-csv.ts";
import {
  prepareTradeDataforceImport,
  TRADE_DATAFORCE_IMPORT_LIMITS,
} from "../src/lib/trade-dataforce-import.ts";
import {
  defaultTradeDataforceServiceCategory,
  isTradeDataforceImport,
  isTradeDataforceServiceCategory,
  TRADE_DATAFORCE_FIELD_MAPPINGS,
  TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS,
} from "../src/lib/trade-dataforce-import-metadata.ts";
import { ENERGY_SERVICE_IDS } from "../src/lib/energy-service-catalogue.mjs";

const row = (overrides = {}) => ({
  ...Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, ""])),
  "App Id": "APP-100", "Job Id": "JOB-100", Status: "audited", SubStatus: "passed", Type: "Normal",
  "Work Type": "Home Energy Rating Assessment", "Scheduled Datetime": "11-Jan-2025 10:00AM",
  Balance: "$ 0.00", "Certificates (VEECs)": "2", Submission: "pending",
  "Field Worker": "[101] Synthetic Worker", Agent: "Synthetic Trade", Client: "Default",
  Customer: "Synthetic Customer", Mobile: "0400 000 001", Email: "synthetic@example.invalid",
  Address: "1 Example Street", Suburb: "Melbourne", Postcode: "3000", ...overrides,
});
const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = (records, headers = DATAFORCE_JOB_CSV_HEADERS) => `\uFEFF${[headers, ...records.map((item) => headers.map((header) => item[header]))].map((values) => values.map(cell).join(",")).join("\r\n")}\r\n`;

test("every Dataforce field has an explicit mapping and its original string survives", () => {
  const source = row({
    "App Id": "  APP-100  ", Customer: '  Synthetic, "Quoted" Customer  ',
    Address: "1 Example Street\r\nUnit 2", "Company Name": "Example Pty Ltd",
    Phone: "03 9000 0000", "Ext Cust Ref": "SOURCE-CUSTOMER-1", Email: "Synthetic@Example.Invalid",
  });
  const plan = prepareTradeDataforceImport(csv([source]));
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.rows[0].record, source);
  assert.deepEqual(TRADE_DATAFORCE_FIELD_MAPPINGS.map((item) => item.header), DATAFORCE_JOB_CSV_HEADERS);
  assert.ok(TRADE_DATAFORCE_FIELD_MAPPINGS.every((item) => item.target && item.note));
  assert.doesNotMatch(JSON.stringify(TRADE_DATAFORCE_FIELD_MAPPINGS), /dataforce/i);
  const mapped = plan.rows[0];
  assert.equal(mapped.sourceAppId, "APP-100");
  assert.equal(mapped.customer.displayName, source.Customer);
  assert.equal(mapped.customer.phone, "03 9000 0000");
  assert.equal(mapped.customer.mobile, "0400 000 001");
  assert.equal(mapped.customer.contactPhone, "0400 000 001");
  assert.equal(mapped.customer.email, "synthetic@example.invalid");
  assert.equal(mapped.customer.externalReference, "SOURCE-CUSTOMER-1");
  assert.equal(mapped.site.addressLine1, source.Address);
  assert.equal(mapped.site.state, "VIC");
  assert.deepEqual(mapped.worker, { sourceId: "101", displayName: "Synthetic Worker" });
});

test("reordered exact headers work without relaxing the compliance CSV contract", () => {
  const headers = [...DATAFORCE_JOB_CSV_HEADERS].reverse();
  const source = csv([row()], headers);
  assert.equal(isTradeDataforceImport(headers), true);
  assert.equal(validateDataforceJobCsv(source).valid, false);
  const plan = prepareTradeDataforceImport(source);
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.rows[0].record, row());
  assert.equal(plan.rows[0].job.scheduledStart, "2025-01-11T10:00");
});

test("extra, missing, duplicated or renamed headers cannot silently lose fields", () => {
  for (const headers of [
    [...DATAFORCE_JOB_CSV_HEADERS, "Private notes"],
    DATAFORCE_JOB_CSV_HEADERS.slice(0, -1),
    [...DATAFORCE_JOB_CSV_HEADERS.slice(0, -1), "Address"],
    DATAFORCE_JOB_CSV_HEADERS.map((header) => header === "Mobile" ? "mobile" : header),
  ]) {
    assert.equal(isTradeDataforceImport(headers), false);
    const plan = prepareTradeDataforceImport(csv([row()], headers));
    assert.equal(plan.valid, false);
    assert.equal(plan.rows.length, 0);
    assert.ok(plan.issues.some((issue) => issue.level === "error"));
  }
});

test("strict CSV errors, blank records, extra cells and row limits are blocking", () => {
  const malformed = `${DATAFORCE_JOB_CSV_HEADERS.join(",")}\n"unclosed`;
  const invalidQuote = prepareTradeDataforceImport(malformed);
  assert.equal(invalidQuote.valid, false);
  assert.ok(invalidQuote.issues.some((item) => item.code === "CSV_QUOTE_UNCLOSED"));
  const blank = prepareTradeDataforceImport(csv([row(), Object.fromEntries(DATAFORCE_JOB_CSV_HEADERS.map((header) => [header, ""]))]));
  assert.equal(blank.valid, false);
  assert.equal(blank.summary.totalRows, 2);
  assert.equal(blank.summary.errorRows, 1);
  const excess = prepareTradeDataforceImport(`${csv([row()]).trimEnd()},extra\n`);
  assert.equal(excess.valid, false);
  const sourceTooLarge = prepareTradeDataforceImport(" ".repeat(TRADE_DATAFORCE_IMPORT_LIMITS.maximumSourceBytes + 1));
  assert.equal(sourceTooLarge.valid, false);
  assert.equal(sourceTooLarge.issues[0].code, "SOURCE_TOO_LARGE");
});

test("local calendar times retain their exact clock time across summer and winter", () => {
  for (const [source, target] of [
    ["11-Jan-2025 10:00AM", "2025-01-11T10:00"],
    ["10-Jul-2025 12:30PM", "2025-07-10T12:30"],
    ["29-Feb-2024 12:00AM", "2024-02-29T00:00"],
    ["30-Sep-2026 11:59PM", "2026-09-30T23:59"],
  ]) {
    const plan = prepareTradeDataforceImport(csv([row({ "Scheduled Datetime": source })]));
    assert.equal(plan.valid, true);
    assert.equal(plan.rows[0].job.scheduledStart, target);
    assert.equal(plan.rows[0].job.scheduledEnd, "");
  }
});

test("a malformed second record invalidates the whole file instead of silently importing its valid prefix", () => {
  const source = `${csv([row()])}${["APP-101", "JOB-101", "assigned"].map(cell).join(",")}\r\n`;
  const plan = prepareTradeDataforceImport(source);
  assert.equal(plan.valid, false);
  assert.equal(plan.summary.totalRows, 2);
  assert.equal(plan.summary.errorRows, 1);
  assert.notEqual(plan.rows.length, plan.summary.totalRows);
  assert.ok(plan.issues.some((item) => item.code === "CSV_ROW_COLUMN_COUNT" && item.rowNumber === 3 && item.level === "error"));
});

test("impossible or ambiguous dates are not converted into fabricated schedules", () => {
  for (const invalid of ["29-Feb-2025 10:00AM", "31-Apr-2026 10:00AM", "01-Jan-2026 00:00AM", "01-Jan-2026 13:00PM", "01-Jan-2026 10:60AM", "01-Feb-2026", "02/03/2026 10:00"]) {
    const plan = prepareTradeDataforceImport(csv([row({ "Scheduled Datetime": invalid })]));
    assert.equal(plan.valid, false, invalid);
    assert.equal(plan.rows[0].record["Scheduled Datetime"], invalid);
    assert.ok(plan.rows[0].issues.some((item) => item.code === "SCHEDULE_INVALID"));
  }
});

test("all imported jobs remain Imported while original lifecycle facts are preserved", () => {
  for (const [status, subStatus] of [
    ["audited", "passed"], ["audited", "waived"],
    ["completed", "field"], ["completed", "partial"], ["assigned", ""],
  ]) {
    const plan = prepareTradeDataforceImport(csv([row({ Status: status, SubStatus: subStatus })]));
    assert.equal(plan.rows[0].job.workStage, "imported");
    assert.equal(plan.rows[0].job.pipelineStage, "imported");
    assert.equal(plan.rows[0].legacy.status, status);
    assert.equal(plan.rows[0].legacy.subStatus, subStatus);
    assert.equal("auditOutcome" in plan.rows[0].job, false);
    assert.equal("authoritativeStatus" in plan.rows[0].job, false);
  }
  const unscheduled = prepareTradeDataforceImport(csv([row({ Status: "assigned", SubStatus: "", "Scheduled Datetime": "" })]));
  assert.equal(unscheduled.rows[0].job.workStage, "imported");
});

test("unknown enums are retained and flagged without inventing their meaning", () => {
  const original = row({ Status: "new-source-state", SubStatus: "awaiting-verification", Type: "Custom",
    "Work Type": "Standard Install", Submission: "regulator-queue", Invoiced: "yes" });
  const plan = prepareTradeDataforceImport(csv([original]));
  assert.equal(plan.valid, true);
  assert.equal(plan.rows[0].status, "warning");
  assert.deepEqual(plan.rows[0].record, original);
  assert.equal(plan.rows[0].job.workStage, "imported");
  assert.equal(plan.rows[0].job.serviceCategory, "other");
  assert.equal(plan.rows[0].job.title, "Standard Install");
  assert.equal(plan.rows[0].issues.length, 6);
  const unknownCompletion = prepareTradeDataforceImport(csv([row({ Status: "completed", SubStatus: "new-incomplete-state" })]));
  assert.equal(unknownCompletion.rows[0].job.workStage, "imported");
});

test("a reviewed service mapping applies only to this import while preserving the source title and every raw field", () => {
  const original = row({ "Work Type": "Standard Install" });
  const source = csv([original]);
  const reviewed = prepareTradeDataforceImport(source, { serviceCategoryMappings: { "Standard Install": "assessment" } });
  assert.equal(reviewed.valid, true);
  assert.equal(reviewed.rows[0].status, "ready");
  assert.equal(reviewed.rows[0].job.serviceCategory, "assessment");
  assert.equal(reviewed.rows[0].job.title, "Standard Install");
  assert.equal(reviewed.rows[0].serviceCategoryOverride, "assessment");
  assert.deepEqual(reviewed.rows[0].record, original);
  const separateImport = prepareTradeDataforceImport(source);
  assert.equal(separateImport.rows[0].job.serviceCategory, "other");
  assert.equal(separateImport.rows[0].serviceCategoryOverride, undefined);
  assert.ok(separateImport.rows[0].issues.some((issue) => issue.code === "WORK_TYPE_UNMAPPED"));
  assert.equal(reviewed.rows[0].customerKey, separateImport.rows[0].customerKey);
  assert.equal(reviewed.rows[0].siteKey, separateImport.rows[0].siteKey);
  const stored = reviewed.rows[0];
  const revalidated = prepareTradeDataforceImport(csv([stored.record]), {
    serviceCategoryMappings: { [stored.record["Work Type"]]: stored.serviceCategoryOverride },
  });
  assert.deepEqual(revalidated.rows[0], stored);
});

test("service mappings use the existing installer categories and allow an explicit reviewed Other choice", () => {
  const values = TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.map((option) => option.value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(ENERGY_SERVICE_IDS.every((category) => values.includes(category)));
  assert.ok(TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.every((option) => option.label && isTradeDataforceServiceCategory(option.value)));
  for (const category of [...ENERGY_SERVICE_IDS, "electrical", "plumbing", "mounting-hardware", "controls"]) {
    const plan = prepareTradeDataforceImport(csv([row({ "Work Type": "Business-specific installation" })]), {
      serviceCategoryMappings: { "Business-specific installation": category },
    });
    assert.equal(plan.valid, true, category);
    assert.equal(plan.rows[0].job.serviceCategory, category);
    assert.ok(!plan.rows[0].issues.some((issue) => issue.code === "WORK_TYPE_UNMAPPED"));
  }
  assert.equal(defaultTradeDataforceServiceCategory(" HOME  ENERGY RATING ASSESSMENT "), "assessment");
  assert.equal(defaultTradeDataforceServiceCategory("Standard Install"), "other");
  assert.equal(isTradeDataforceServiceCategory("unsupported-service"), false);
  assert.equal(isTradeDataforceServiceCategory(null), false);
});

test("unsupported, irrelevant, malformed and conflicting reviewed mappings cannot stage a guessed category", () => {
  const source = csv([row({ "Work Type": "Standard Install" })]);
  for (const serviceCategoryMappings of [
    { "Standard Install": "unsupported-service" },
    { "Missing source work type": "assessment" },
    { "Standard Install": "ASSESSMENT" },
    { "Standard Install": 2 },
    { "Standard Install": null },
    { "": "assessment" },
    { "Standard Install": "assessment", " STANDARD  INSTALL ": "plumbing" },
    [], null, "assessment",
  ]) {
    const plan = prepareTradeDataforceImport(source, { serviceCategoryMappings });
    assert.equal(plan.valid, false);
    assert.equal(plan.rows.length, 0);
    assert.equal(plan.summary.errorRows, 1);
    assert.ok(plan.issues.some((issue) => issue.code === "SERVICE_CATEGORY_MAPPING_INVALID" && issue.level === "error"));
  }
  const canonicalMapping = prepareTradeDataforceImport(source, { serviceCategoryMappings: { " STANDARD  INSTALL ": "plumbing" } });
  assert.equal(canonicalMapping.valid, true);
  assert.equal(canonicalMapping.rows[0].job.serviceCategory, "plumbing");
});

test("balances and certificate counts are preserved independently of billing and regulatory state", () => {
  const plan = prepareTradeDataforceImport(csv([row({ Balance: "$ 1,234.56", "Certificates (VEECs)": "2", Submission: "accepted" })]));
  assert.equal(plan.rows[0].legacy.balanceCents, 123456);
  assert.equal(plan.rows[0].legacy.certificateCount, 2);
  assert.equal(plan.rows[0].legacy.submission, "accepted");
  assert.equal("invoice" in plan.rows[0], false);
  assert.equal("payment" in plan.rows[0], false);
  assert.equal("issuance" in plan.rows[0], false);
  const unknown = prepareTradeDataforceImport(csv([row({ Balance: "unknown", "Certificates (VEECs)": "2.5" })]));
  assert.equal(unknown.valid, true);
  assert.equal(unknown.rows[0].legacy.balanceCents, null);
  assert.equal(unknown.rows[0].legacy.certificateCount, null);
  assert.equal(unknown.rows[0].record.Balance, "unknown");
  const absent = prepareTradeDataforceImport(csv([row({ Balance: "", "Certificates (VEECs)": "" })]));
  assert.equal(absent.rows[0].legacy.balanceCents, null);
  assert.equal(absent.rows[0].legacy.certificateCount, null);
});

test("shared contact details never merge different names; each job retains its separate site", () => {
  const plan = prepareTradeDataforceImport(csv([
    row(),
    row({ "Job Id": "JOB-101", "App Id": "APP-101", Customer: "Different Customer" }),
    row({ "Job Id": "JOB-102", "App Id": "APP-102", Address: "2 Example Street" }),
    row({ "Job Id": "JOB-103", "App Id": "APP-103", Mobile: "+61 400 000 001", Email: "SYNTHETIC@EXAMPLE.INVALID" }),
  ]));
  assert.notEqual(plan.rows[0].customerKey, plan.rows[1].customerKey);
  assert.equal(plan.rows[0].customerKey, plan.rows[2].customerKey);
  assert.notEqual(plan.rows[0].siteKey, plan.rows[2].siteKey);
  assert.equal(plan.rows[0].customerKey, plan.rows[3].customerKey);
  assert.deepEqual(plan.summary, { totalRows: 4, readyRows: 4, warningRows: 0, errorRows: 0, customerCount: 2, siteCount: 2 });
});

test("changed contact values are preserved as distinct identities instead of overwritten", () => {
  const plan = prepareTradeDataforceImport(csv([
    row(), row({ "Job Id": "JOB-101", "App Id": "APP-101", Email: "updated@example.invalid" }),
    row({ "Job Id": "JOB-102", "App Id": "APP-102", Phone: "03 9000 0000" }),
  ]));
  assert.equal(new Set(plan.rows.map((item) => item.customerKey)).size, 3);
});

test("missing contact details use the full name and address, never name alone", () => {
  const plan = prepareTradeDataforceImport(csv([
    row({ Email: "", Mobile: "" }),
    row({ "Job Id": "JOB-101", "App Id": "APP-101", Email: "", Mobile: "", Address: "2 Example Street" }),
  ]));
  assert.equal(plan.valid, true);
  assert.notEqual(plan.rows[0].customerKey, plan.rows[1].customerKey);
  assert.ok(plan.rows.every((item) => item.issues.some((issue) => issue.code === "CONTACT_DETAILS_MISSING")));
});

test("postcode locality matching handles state boundaries and retains old suburb names", () => {
  const plan = prepareTradeDataforceImport(csv([
    row({ Postcode: "0872", Suburb: "AMATA" }),
    row({ "Job Id": "JOB-101", "App Id": "APP-101", Postcode: "0872", Suburb: "UNRECOGNISED" }),
    row({ "Job Id": "JOB-102", "App Id": "APP-102", Postcode: "3940", Suburb: "ROSEBUD WEST" }),
    row({ "Job Id": "JOB-103", "App Id": "APP-103", Postcode: "9999", Suburb: "UNRECOGNISED" }),
  ]));
  assert.equal(plan.rows[0].site.state, "SA");
  assert.equal(plan.rows[1].site.state, "");
  assert.equal(plan.rows[2].site.state, "VIC");
  assert.equal(plan.rows[2].site.suburb, "ROSEBUD WEST");
  assert.equal(plan.rows[3].site.state, "");
  assert.ok(plan.rows.slice(1).every((item) => item.issues.some((issue) => issue.code === "LOCALITY_REVIEW")));
});

test("duplicate source job IDs block the batch independently of header order", () => {
  for (const headers of [DATAFORCE_JOB_CSV_HEADERS, [...DATAFORCE_JOB_CSV_HEADERS].reverse()]) {
    const plan = prepareTradeDataforceImport(csv([row(), row({ "Job Id": " job-100 ", "App Id": "APP-101" })], headers));
    assert.equal(plan.valid, false);
    assert.equal(plan.summary.errorRows, 1);
    assert.equal(plan.rows[1].issues.at(-1).code, "DUPLICATE_JOB_ID");
  }
});

test("reused appointment IDs are preserved for review without dropping distinct jobs", () => {
  const plan = prepareTradeDataforceImport(csv([row(), row({ "Job Id": "JOB-101" })]));
  assert.equal(plan.valid, true);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[1].status, "warning");
  assert.ok(plan.rows[1].issues.some((issue) => issue.code === "DUPLICATE_APP_ID"));
});
