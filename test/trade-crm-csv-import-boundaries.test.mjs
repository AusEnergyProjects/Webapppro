import test from "node:test";
import assert from "node:assert/strict";
import { prepareTradeCrmCsvImport, TradeCrmCsvValidationError } from "../src/lib/trade-crm-csv-import.ts";
import { suggestTradeCrmCsvMapping } from "../src/lib/trade-crm-csv-import-metadata.ts";

const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const csv = (headers, rows) => [headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
const sourceFile = (role, headers, rows, overrides = {}) => ({ id: role, fileName: `${role}.csv`, role, csvText: csv(headers, rows), mapping: suggestTradeCrmCsvMapping(headers, role), ...overrides });
const options = overrides => ({ sourceNamespace: "Synthetic boundary account", unmatchedJobs: "use_job_contacts", serviceCategoryMappings: {}, excludedRows: {}, ...overrides });
const clientHeaders = ["Client ID", "Name", "Contact First", "Contact Last", "Email Address", "Company Address"];
const jobHeaders = ["Job Number", "Client ID", "Company", "Contact First", "Contact Last", "Job Category", "Job Address", "Scheduled Start", "Scheduled End", "Job Status"];
const client = (id, name = `Business ${id}`) => [id, name, `Contact ${id}`, "Customer", `${id.toLowerCase()}@example.test`, "1 Example Street\nMelbourne VIC 3000"];
const job = (id, clientId = "", category = "Home Energy Rating Assessment", start = "", end = "") => [id, clientId, `Source company ${id}`, "Site", `Contact ${id}`, category, "2 Example Street\nMelbourne VIC 3000", start, end, "Completed"];
const jobsIn = plan => plan.rows.filter(row => row.entityType === "job");
const clientsIn = plan => plan.rows.filter(row => row.entityType === "customer");
const hasIssue = (row, code) => row.issues.some(issue => issue.code === code);
const singleJob = (values, overrides = {}) => jobsIn(prepareTradeCrmCsvImport([sourceFile("jobs", jobHeaders, [values])], options(overrides)))[0];

test("source IDs and headers matching prototype names remain exact data and never change object prototypes", () => {
  const headers = ["__proto__", "constructor", "toString", "Full Address"];
  const rows = [["__proto__", "Constructor Customer", "unknown source value", "1 Example St\nMelbourne VIC 3000"], ["constructor", "Second Customer", "second original", "2 Example St\nMelbourne VIC 3000"]];
  const file = sourceFile("customers", headers, rows, { id: "__proto__", mapping: { "customer.externalId": "__proto__", "customer.displayName": "constructor", "customer.address": "Full Address" } });
  const plan = prepareTradeCrmCsvImport([file], options());
  assert.deepEqual(plan.rows.map(row => row.sourceId), ["__proto__", "constructor"]);
  assert.equal(plan.rows[0].customer.displayName, "Constructor Customer");
  for (const [index, row] of plan.rows.entries()) {
    assert.equal(Object.getPrototypeOf(row.record), Object.prototype);
    assert.deepEqual(Object.keys(row.record), headers);
    assert.equal(Object.hasOwn(row.record, "__proto__"), true);
    assert.deepEqual(Object.values(row.record), rows[index]);
    assert.equal(row.excluded, false);
  }
  assert.equal({}.polluted, undefined);
});

test("prototype category names need explicit own-property overrides and otherwise remain Other", () => {
  for (const category of ["__proto__", "constructor", "toString"]) {
    const withoutOverride = singleJob(job(`JOB-${category}`, "", category));
    assert.equal(withoutOverride.job.serviceCategory, "other");
    assert.equal(hasIssue(withoutOverride, "CATEGORY_REVIEW"), true);
    const withOverride = singleJob(job(`JOB-${category}`, "", category), { serviceCategoryMappings: Object.fromEntries([[category, "electrical"]]) });
    assert.equal(withOverride.job.serviceCategory, "electrical");
    assert.equal(hasIssue(withOverride, "CATEGORY_REVIEW"), false);
    assert.equal(withOverride.record["Job Category"], category);
  }
});

test("exclusions use original file row numbers even when file order changes and special IDs survive JSON", () => {
  const files = [sourceFile("jobs", jobHeaders, [job("JOB-1"), job("JOB-2")], { id: "__proto__" }), sourceFile("customers", clientHeaders, [client("CLIENT-1")])];
  const excludedRows = JSON.parse('{"__proto__":[3]}');
  const plan = prepareTradeCrmCsvImport(files, options({ excludedRows }));
  assert.equal(plan.summary.totalRows, 3);
  assert.equal(plan.summary.excludedRows, 1);
  assert.equal(plan.rows[0].entityType, "customer", "Combined processing order may change without changing source row identity");
  assert.equal(clientsIn(plan)[0].excluded, false);
  assert.equal(jobsIn(plan)[0].excluded, false);
  assert.equal(jobsIn(plan)[1].excluded, true);
  assert.equal(jobsIn(plan)[1].sourceRowNumber, 3);
  assert.equal(jobsIn(plan)[1].rowNumber, 4);
  assert.equal(plan.files[0].csvText, files[0].csvText);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.options)).excludedRows, excludedRows);
  for (const rowNumber of [1, 2.5, 999]) assert.throws(() => prepareTradeCrmCsvImport(files, options({ excludedRows: Object.fromEntries([["__proto__", [rowNumber]]]) })), TradeCrmCsvValidationError);
});

test("duplicate client keys block all ambiguous clients and their dependent jobs", () => {
  const plan = prepareTradeCrmCsvImport([sourceFile("customers", clientHeaders, [client("SHARED", "Business A"), client("SHARED", "Business B")]), sourceFile("jobs", jobHeaders, [job("JOB-1", "SHARED")])], options({ unmatchedJobs: "block" }));
  for (const row of clientsIn(plan)) { assert.equal(row.status, "error"); assert.equal(hasIssue(row, "DUPLICATE_SOURCE_ID"), true); }
  const target = jobsIn(plan)[0];
  assert.equal(target.status, "error");
  assert.equal(hasIssue(target, "CLIENT_LINK_AMBIGUOUS"), true);
  assert.equal(target.linkedClient, undefined);
  assert.equal(target.customer.businessName, "Source company JOB-1");
});

test("duplicate job IDs are rejected without collapsing rows or confusing customer IDs with job IDs", () => {
  const plan = prepareTradeCrmCsvImport([sourceFile("customers", clientHeaders, [client("SAME")]), sourceFile("jobs", jobHeaders, [job("SAME", "SAME"), job("SAME", "SAME")])], options({ unmatchedJobs: "block" }));
  assert.equal(plan.rows.length, 3);
  assert.equal(hasIssue(clientsIn(plan)[0], "DUPLICATE_SOURCE_ID"), false);
  for (const row of jobsIn(plan)) {
    assert.equal(row.status, "error"); assert.equal(hasIssue(row, "DUPLICATE_SOURCE_ID"), true);
    assert.equal(row.linkedClient.sourceId, "SAME"); assert.equal(row.record["Job Number"], "SAME");
  }
});

test("paired jobs join explicit client keys independently of file or row ordering", () => {
  const customerFile = sourceFile("customers", clientHeaders, [client("CLIENT-A", "Account Alpha"), client("CLIENT-B", "Account Beta")]);
  const jobFile = sourceFile("jobs", jobHeaders, [job("JOB-B", "CLIENT-B"), job("JOB-A", "CLIENT-A")]);
  for (const files of [[customerFile, jobFile], [jobFile, customerFile]]) {
    const plan = prepareTradeCrmCsvImport(files, options({ unmatchedJobs: "block" }));
    const byId = new Map(jobsIn(plan).map(row => [row.sourceId, row]));
    assert.equal(byId.get("JOB-B").customer.businessName, "Account Beta");
    assert.equal(byId.get("JOB-A").customer.businessName, "Account Alpha");
    assert.equal(byId.get("JOB-B").linkedClient.sourceRowNumber, 3);
    assert.equal(byId.get("JOB-A").linkedClient.sourceRowNumber, 2);
    assert.equal(byId.get("JOB-B").record.Company, "Source company JOB-B");
    assert.ok(byId.get("JOB-B").contacts.some(contact => contact.roleLabel === "Site contact" && contact.firstName === "Site"));
  }
});

test("unmatched or excluded clients cannot be joined by row position, similar names or fallback", () => {
  const customerFile = sourceFile("customers", clientHeaders, [client("CLIENT-A", "Source company JOB-1")]);
  const jobFile = sourceFile("jobs", jobHeaders, [job("JOB-1", "client-a")]);
  const unmatched = jobsIn(prepareTradeCrmCsvImport([customerFile, jobFile], options({ unmatchedJobs: "block" })))[0];
  assert.equal(unmatched.linkedClient, undefined); assert.equal(hasIssue(unmatched, "CLIENT_LINK_MISSING"), true);
  const exactJobFile = sourceFile("jobs", jobHeaders, [job("JOB-1", "CLIENT-A")]);
  const excluded = jobsIn(prepareTradeCrmCsvImport([customerFile, exactJobFile], options({ excludedRows: { customers: [2] } })))[0];
  assert.equal(excluded.linkedClient, undefined);
  assert.equal(hasIssue(excluded, "CLIENT_LINK_UNAVAILABLE"), true);
  assert.equal(excluded.status, "error", "An explicitly excluded client must not silently create an alternative account");
});

test("quoted multiline addresses and billing addresses map separately while exact source cells survive", () => {
  const customerAddress = "Unit 2, 3 Example Street\r\nRichmond VIC 3121";
  const billingAddress = "PO Box 7\nMelbourne VIC 3000";
  const headers = [...clientHeaders, "Billing Address", "Billing Contact First", "Billing Contact Last"];
  const values = [...client("CLIENT-1").slice(0, 5), customerAddress, billingAddress, "Accounts", "Person"];
  const row = prepareTradeCrmCsvImport([sourceFile("customers", headers, [values])], options()).rows[0];
  assert.deepEqual(row.customerAddress, { addressLine1: "Unit 2, 3 Example Street", suburb: "Richmond", state: "VIC", postcode: "3121" });
  assert.deepEqual(row.billing, { addressLine1: "PO Box 7", suburb: "Melbourne", state: "VIC", postcode: "3000", country: "" });
  assert.equal(row.record["Company Address"], customerAddress);
  assert.equal(row.record["Billing Address"], billingAddress);
  assert.ok(row.contacts.some(contact => contact.roleLabel === "Billing contact" && contact.firstName === "Accounts"));
});

test("invalid Australian and ISO visit dates stay visible as row errors without guessed appointments", () => {
  for (const start of ["29/02/2025 10:00", "31/04/2026 10:00", "1/13/2026 10:00", "30/09/2026 24:00", "30/09/2026 10:60", "30/09/2026", "2026-09-30T25:01", "2026-09-30T10:00Z"]) {
    const row = singleJob(job("JOB-1", "", "Home Energy Rating Assessment", start));
    assert.equal(row.status, "error", start); assert.equal(hasIssue(row, "SCHEDULE_INVALID"), true, start);
    assert.equal(row.job.scheduledStart, "", start); assert.equal(row.record["Scheduled Start"], start);
  }
  const valid = singleJob(job("JOB-2", "", "Home Energy Rating Assessment", "29/02/2024 9:05"));
  assert.equal(valid.job.scheduledStart, "2024-02-29T09:05");
  assert.equal(valid.job.scheduledEnd, "", "Missing durations must stay missing");
});

test("malformed visit seconds cannot be silently accepted and truncated", () => {
  for (const start of ["30/09/2026 10:00:99", "2026-09-30T10:00:60"]) {
    const row = singleJob(job("JOB-1", "", "Home Energy Rating Assessment", start));
    assert.equal(hasIssue(row, "SCHEDULE_INVALID"), true, start);
    assert.equal(row.job.scheduledStart, "", start);
  }
});

test("visit ends require a valid start and cannot precede it", () => {
  for (const [start, end] of [["", "30/09/2026 10:00"], ["30/09/2026 11:00", "30/09/2026 10:00"]]) {
    const row = singleJob(job("JOB-1", "", "Home Energy Rating Assessment", start, end));
    assert.equal(row.status, "error"); assert.equal(hasIssue(row, "SCHEDULE_ORDER_INVALID"), true);
    assert.equal(row.record["Scheduled End"], end);
  }
});

test("original-only financial fields, formulas, spaces and leading zeros are preserved without operational approval", () => {
  const headers = [...jobHeaders, "Invoice Total", "Payment State", "Unknown custom field", "External padded ID"];
  const values = [...job("0000007"), "00123.40", "Paid", '  =HYPERLINK("https://example.test","original")  ', "00001"];
  const file = sourceFile("jobs", headers, [values]);
  const plan = prepareTradeCrmCsvImport([file], options());
  const row = jobsIn(plan)[0];
  assert.deepEqual(Object.entries(row.record), headers.map((header, index) => [header, values[index]]));
  assert.equal(row.sourceId, "0000007"); assert.equal(row.job.workStage, "imported"); assert.equal(row.job.pipelineStage, "imported");
  assert.equal(row.legacy.status, "Completed");
  for (const header of headers.slice(jobHeaders.length)) assert.equal(plan.fieldMappings.find(mapping => mapping.header === header).target, "Original source only");
  assert.equal(plan.files[0].csvText, file.csvText);
  assert.equal(Object.hasOwn(row, "invoice"), false); assert.equal(Object.hasOwn(row, "payment"), false);
});

test("invalid mapping columns and malformed CSV rows fail before any rows can disappear", () => {
  const valid = sourceFile("jobs", jobHeaders, [job("JOB-1")]);
  assert.throws(() => prepareTradeCrmCsvImport([{ ...valid, mapping: { ...valid.mapping, "job.sourceId": "Missing header" } }], options()), TradeCrmCsvValidationError);
  assert.throws(() => prepareTradeCrmCsvImport([{ ...valid, mapping: { ...valid.mapping, "unexpected.target": "Job Number" } }], options()), TradeCrmCsvValidationError);
  const duplicateHeaders = sourceFile("jobs", ["Job Number", "Company", "Company"], [["JOB-1", "A", "B"]]);
  assert.throws(() => prepareTradeCrmCsvImport([duplicateHeaders], options()), /unique, nonempty column names/);
  const malformedRow = sourceFile("jobs", ["Job Number", "Company"], [["JOB-1", "A"], ["JOB-2"]]);
  assert.throws(() => prepareTradeCrmCsvImport([malformedRow], options()), /every source row must match/);
});
