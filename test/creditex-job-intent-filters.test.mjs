import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as filters from "../src/lib/creditex-job-intent-filters.ts";
import * as certificateTypes from "../src/lib/creditex-certificate-types.ts";
import { GOVERNMENT_PROGRAM_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE intent (id TEXT, compliance_organisation_id TEXT, program_code TEXT, registry_activity_code TEXT, intent_snapshot TEXT, planned_start TEXT, updated_at TEXT);
    CREATE TABLE work (id TEXT, work_number TEXT, title TEXT, stage TEXT, priority TEXT, created_at TEXT);
    CREATE TABLE details (id TEXT, quote_status TEXT, invoice_status TEXT);
    CREATE TABLE customer (id TEXT, business_name TEXT, first_name TEXT, last_name TEXT, customer_number TEXT);
    CREATE TABLE site (id TEXT, address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE account (id TEXT, business_name TEXT);`);
  for (const row of [
    ["a", "org", "VEU", "2026-09-21T08:00:00", "completed", "low", "Zoe", "A Plumbing", "Sydney"],
    ["b", "org", "SRES", "2026-09-22T08:00:00", "scheduled", "urgent", "Amy", "B Solar", "Melbourne"],
    ["c", "org", "VEU", "2026-09-23T08:00:00", "scheduled", "high", "Ben", "A Plumbing", "Sydney"],
    ["d", "org", "VEU", "", "scheduled", "standard", "Amy", "100%_\\ Trade", "Melbourne"],
    ["e", "other", "VEU", "2026-09-22T08:00:00", "scheduled", "urgent", "Private", "Other", "Sydney"],
  ]) {
    const [id, org, program, date, stage, priority, name, installer, suburb] = row;
    database.prepare("INSERT INTO intent VALUES (?,?,?,?,?,?,?)").run(id, org, program, "6", JSON.stringify({ activity: { title: "Heat pump" }, program: { claimOutputCode: program === "SRES" ? "STC" : "VEEC" } }), date, "2026-09-20");
    const createdAt = { a: "2026-09-19T14:00:00.000Z", b: "2026-09-20T13:59:59.999Z", c: "2026-09-20T14:00:00.000Z", d: "", e: "2026-09-19T14:00:00.000Z" }[id];
    database.prepare("INSERT INTO work VALUES (?,?,?,?,?,?)").run(id, `JOB-${id}`, "Heat pump installation", stage, priority, createdAt);
    database.prepare("INSERT INTO details VALUES (?,?,?)").run(id, id === "a" ? "accepted" : "draft", id === "a" ? "sent" : "none");
    const lastName = { a: "Rivers", b: "Singh", c: "Singh", d: "W%_\\Literal", e: "Private" }[id];
    database.prepare("INSERT INTO customer VALUES (?,?,?,?,?)").run(id, "", name, lastName, `C-${id}`);
    database.prepare("INSERT INTO site VALUES (?,?,?,?,?,?)").run(id, "1 Main Street", "", suburb, "VIC", "3000");
    database.prepare("INSERT INTO account VALUES (?,?)").run(id, installer);
  }
  const query = values => {
    const options = filters.creditexJobIntentFilters(new URLSearchParams(values));
    const from = `FROM intent JOIN work ON work.id=intent.id JOIN details ON details.id=intent.id JOIN customer ON customer.id=intent.id JOIN site ON site.id=intent.id JOIN account ON account.id=intent.id WHERE intent.compliance_organisation_id=? ${options.filterSql}`;
    const bindings = ["org", ...options.filterBindings];
    return { ids: database.prepare(`SELECT intent.id ${from} ORDER BY ${options.sortSql}`).all(...bindings).map(row => row.id), count: database.prepare(`SELECT count(*) AS n ${from}`).get(...bindings).n };
  };
  return { query, database, close: () => database.close() };
}

test("creation filters use inclusive Australian days from the work record and put missing dates last", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ createdFrom: "2026-09-20", createdTo: "2026-09-20" }), { ids: ["a", "b"], count: 2 });
    assert.deepEqual(f.query({ createdFrom: "2026-09-21" }), { ids: ["c"], count: 1 });
    assert.deepEqual(f.query({ createdTo: "2026-09-20" }), { ids: ["a", "b"], count: 2 });
    assert.deepEqual(f.query({ sort: "createdAt", sortDirection: "desc" }).ids, ["c", "b", "a", "d"]);
    assert.deepEqual(f.query({ sort: "createdAt", sortDirection: "asc" }).ids, ["a", "b", "c", "d"]);
    assert.deepEqual(f.query({ createdFrom: "2026-09-20", createdTo: "2026-09-20", plannedFrom: "2026-09-22" }), { ids: ["b"], count: 1 });
  } finally { f.close(); }
});

test("creation date range follows daylight-saving midnight boundaries without including the next day", () => {
  const f = fixture();
  try {
    for (const [id, created] of [["a", "2026-10-03T14:00:00Z"], ["b", "2026-10-04T12:59:59.999Z"], ["c", "2026-10-04T13:00:00Z"]]) f.database.prepare("UPDATE work SET created_at=? WHERE id=?").run(created, id);
    assert.deepEqual(f.query({ createdFrom: "2026-10-04", createdTo: "2026-10-04" }), { ids: ["a", "b"], count: 2 });
  } finally { f.close(); }
});

test("first and last name filters and sorts use independent saved fields and literal search text", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ firstName: "Amy", lastName: "Singh" }), { ids: ["b"], count: 1 });
    assert.deepEqual(f.query({ firstName: "Singh" }), { ids: [], count: 0 });
    assert.deepEqual(f.query({ lastName: "Amy" }), { ids: [], count: 0 });
    assert.deepEqual(f.query({ lastName: "%_\\" }), { ids: ["d"], count: 1 });
    assert.deepEqual(f.query({ firstName: "Private" }), { ids: [], count: 0 });
    assert.deepEqual(f.query({ sort: "customerFirstName" }).ids, ["b", "d", "c", "a"]);
    assert.deepEqual(f.query({ sort: "customerLastName" }).ids, ["a", "b", "c", "d"]);
    assert.deepEqual(f.query({ sort: "customerLastName", sortDirection: "desc" }).ids, ["d", "b", "c", "a"]);
    f.database.prepare("UPDATE customer SET business_name='A business name', first_name='', last_name='' WHERE id='a'").run();
    assert.deepEqual(f.query({ firstName: "business" }), { ids: [], count: 0 });
    assert.deepEqual(f.query({ customer: "business" }), { ids: ["a"], count: 1 });
  } finally { f.close(); }
});

test("combined program, installer, stage, priority and inclusive dates filter the same rows and total", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ program: "VEU", installer: "Plumbing", jobStage: "scheduled", priority: "high", plannedFrom: "2026-09-23", plannedTo: "2026-09-23" }), { ids: ["c"], count: 1 });
    assert.deepEqual(f.query({ plannedFrom: "2026-09-21", plannedTo: "2026-09-22" }), { ids: ["a", "b"], count: 2 });
    assert.deepEqual(f.query({ plannedTo: "2026-09-23" }), { ids: ["a", "b", "c"], count: 3 });
    assert.deepEqual(f.query({ job: "JOB-a", quoteStatus: "accepted", invoiceStatus: "sent" }), { ids: ["a"], count: 1 });
  } finally { f.close(); }
});

test("certificate type filters use the saved output, are exact and exclude non-certificate work without changing organisation scope", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ certificateType: "STC" }), { ids: ["b"], count: 1 });
    assert.deepEqual(f.query({ certificateType: "VEEC", jobStage: "scheduled" }), { ids: ["c", "d"], count: 2 });
    assert.deepEqual(f.query({ certificateType: "certificates" }), { ids: ["a", "b", "c", "d"], count: 4 });
    assert.deepEqual(f.query({ certificateType: "all" }), f.query({}));
    f.database.prepare("UPDATE intent SET intent_snapshot=? WHERE id='a'").run(JSON.stringify({ program: { claimOutputCode: "REBATE" } }));
    f.database.prepare("UPDATE intent SET intent_snapshot=? WHERE id='c'").run(JSON.stringify({ program: { claimOutputCode: "ESC" } }));
    f.database.prepare("UPDATE intent SET intent_snapshot='{}' WHERE id='d'").run();
    assert.deepEqual(f.query({ certificateType: "certificates" }), { ids: ["b", "c"], count: 2 });
    assert.deepEqual(f.query({ certificateType: "ESC" }), { ids: ["c"], count: 1 });
    assert.deepEqual(f.query({ certificateType: "VEEC" }), { ids: [], count: 0 }, 'program code alone never invents a type absent from the saved snapshot');
    for (const code of certificateTypes.CREDITEX_CERTIFICATE_TYPES) {
      assert.ok(GOVERNMENT_PROGRAM_TEMPLATES.some(program => program.claimOutputCode === code), code);
      f.database.prepare("UPDATE intent SET intent_snapshot=? WHERE id='c'").run(JSON.stringify({ program: { claimOutputCode: code } }));
      assert.ok(f.query({ certificateType: code }).ids.includes("c"));
    }
    for (const invalid of ["ST", "stc", "REBATE", "STC' OR 1=1 --", "invented", "VEEC,STC"]) assert.throws(() => f.query({ certificateType: invalid }), /supported certificate type/);
  } finally { f.close(); }
});

test("case details join only the exact authorised organisation, installer, work order and intent", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE trade_work_order_compliance_intents(id TEXT,compliance_case_id TEXT,compliance_organisation_id TEXT,installer_uid TEXT,work_order_id TEXT);
      CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT);
      CREATE TABLE trade_crm_job_details(work_order_id TEXT,firebase_uid TEXT,customer_source TEXT,crm_customer_id TEXT,service_site_id TEXT);
      CREATE TABLE trade_crm_customers(id TEXT,firebase_uid TEXT);
      CREATE TABLE trade_crm_service_sites(id TEXT,firebase_uid TEXT,customer_id TEXT);
      CREATE TABLE trade_accounts(firebase_uid TEXT);
      CREATE TABLE compliance_cases(id TEXT,organisation_id TEXT,installer_uid TEXT,work_order_id TEXT,compliance_intent_id TEXT,case_number TEXT);
      INSERT INTO trade_work_order_compliance_intents VALUES('intent','case','org','installer','job');
      INSERT INTO compliance_cases VALUES('case','org','installer','job','intent','CASE-1');`);
    const source = fs.readFileSync(new URL("../src/app/api/creditex/job-intents/route.ts", import.meta.url), "utf8");
    const joins = source.match(/const QUEUE_JOINS = `([\s\S]*?)`;/)[1];
    const query = () => db.prepare(`SELECT linked_case.case_number ${joins} WHERE intent.compliance_organisation_id=?`).get('org');
    assert.equal(query().case_number, 'CASE-1');
    for (const [column, original] of [['organisation_id','org'],['installer_uid','installer'],['work_order_id','job'],['compliance_intent_id','intent']]) {
      db.prepare(`UPDATE compliance_cases SET ${column}=?`).run('other'); assert.equal(query().case_number, null, column);
      db.prepare(`UPDATE compliance_cases SET ${column}=?`).run(original);
    }
  } finally { db.close(); }
});

test("column text filters use literal wildcard characters and do not escape organisation scope", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ installer: "100%_\\" }), { ids: ["d"], count: 1 });
    assert.deepEqual(f.query({ customer: "Amy", serviceSite: "Melbourne", activity: "pump" }), { ids: ["b", "d"], count: 2 });
    assert.deepEqual(f.query({ installer: "' OR 1=1 --" }), { ids: [], count: 0 });
    assert.deepEqual(f.query({ customer: "Private" }), { ids: [], count: 0 });
  } finally { f.close(); }
});

test("sorts are allowlisted, priority is semantic, missing planned dates stay last and ties are stable", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ sort: "priority", sortDirection: "desc" }).ids, ["b", "c", "d", "a"]);
    assert.deepEqual(f.query({ sort: "customerName", sortDirection: "asc" }).ids, ["b", "d", "c", "a"]);
    assert.deepEqual(f.query({ sort: "plannedStart", sortDirection: "desc" }).ids, ["c", "b", "a", "d"]);
    for (const sort of ["jobNumber", "installerBusiness", "programCode", "jobStage", "updatedAt"]) assert.equal(f.query({ sort }).count, 4);
    assert.throws(() => filters.creditexJobIntentFilters(new URLSearchParams({ sort: "intent.id; DROP TABLE work" })), /supported job-list sort/);
    assert.throws(() => filters.creditexJobIntentFilters(new URLSearchParams({ sortDirection: "desc; --" })), /ascending or descending/);
  } finally { f.close(); }
});

test("invalid or reversed calendar dates are rejected rather than broadening results", () => {
  for (const values of [{ plannedFrom: "2026-02-30" }, { plannedTo: "nonsense" }, { plannedFrom: "2026-09-22", plannedTo: "2026-09-21" }, { createdFrom: "2026-02-30" }, { createdTo: "nonsense" }, { createdFrom: "2026-09-22", createdTo: "2026-09-21" }]) assert.throws(() => filters.creditexJobIntentFilters(new URLSearchParams(values)), filters.CreditexQueueFilterError);
});

test("route applies identical filter bindings to count and page query while retaining Creditex access checks", async () => {
  const source = fs.readFileSync(new URL("../src/app/api/creditex/job-intents/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const queries = []; let organisationCode = "creditex";
  class AccessError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
  const database = { prepare: sql => ({ bind: (...bindings) => { const entry = { sql, bindings }; queries.push(entry); return { first: async () => ({ total: 76 }), all: async () => ({ results: [
    { id: "current", job_created_at: "2026-09-19T14:00:00.000Z", created_at: "2026-09-23T00:00:00Z", first_name: "Mary Jane", last_name: "van Example", customer_business_name: "Example Business", intent_snapshot: JSON.stringify({ program: { claimOutputCode: "VEEC", claimOutputLabel: "Victorian energy efficiency certificates" }, activity: { title: "Heat pump installation", activityKey: "heat-pump" } }), case_number: "CX-100", case_status: "submitted", evidence_status: "verified", suburb: "Melbourne", postcode: "3000" },
    { id: "retained", job_created_at: null, created_at: "2026-09-23T00:00:00Z", first_name: null, last_name: null, customer_business_name: "Business Only Pty Ltd" },
  ] }) }; } }) };
  const dependencies = { "../../../../../db": { getD1: () => database }, "@/lib/compliance-access-server": { ComplianceAccessError: AccessError, requireComplianceAccess: async () => ({ organisationCode, organisationId: "authorised-org" }) }, "@/lib/trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" }, "@/lib/creditex-job-intent-filters": filters, "@/lib/creditex-certificate-types": certificateTypes };
  const exported = {};
  Function("require", "exports", compiled)(name => { assert.ok(dependencies[name]); return dependencies[name]; }, exported);
  const request = new Request("https://example.test/api/creditex/job-intents?certificateType=VEEC&program=VEU&installer=Acme&plannedFrom=2026-09-21&createdFrom=2026-09-20&createdTo=2026-09-20&firstName=Mary&lastName=Example&sort=priority&sortDirection=desc&page=2");
  const response = await exported.GET(request); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.total, 76); assert.equal(result.page, 2); assert.equal(result.sort, "priority");
  assert.equal(result.pageSize, 50); assert.equal(result.totalPages, 2); assert.equal(result.certificateType, "VEEC");
  assert.equal(result.items[0].certificateType, "VEEC"); assert.equal(result.items[0].claimOutputCode, "VEEC"); assert.equal(result.items[0].activityTitle, "Heat pump installation");
  assert.equal(result.items[0].caseNumber, "CX-100"); assert.equal(result.items[0].caseStatus, "submitted"); assert.equal(result.items[0].evidenceStatus, "verified"); assert.equal(result.items[0].siteSuburb, "Melbourne"); assert.equal(result.items[0].sitePostcode, "3000");
  assert.equal(result.items[1].certificateType, ""); assert.equal(result.items[1].activityTitle, ""); assert.equal(result.items[1].caseStatus, "");
  assert.equal(result.items[0].createdAt, "2026-09-19T14:00:00.000Z"); assert.equal(result.items[0].customerFirstName, "Mary Jane"); assert.equal(result.items[0].customerLastName, "van Example"); assert.equal(result.items[0].customerBusinessName, "Example Business");
  assert.equal(result.items[1].createdAt, ""); assert.equal(result.items[1].customerFirstName, ""); assert.equal(result.items[1].customerLastName, ""); assert.equal(result.items[1].customerName, "Business Only Pty Ltd");
  assert.equal(queries.length, 2); assert.deepEqual(queries[1].bindings.slice(0, -2), queries[0].bindings); assert.deepEqual(queries[1].bindings.slice(-2), [50, 50]);
  assert.equal(queries[0].bindings[0], "authorised-org");
  for (const query of queries) { assert.match(query.sql, /intent\.program_code = \?/); assert.match(query.sql, /account\.business_name\) LIKE \?/); assert.match(query.sql, /substr\(intent\.planned_start, 1, 10\) >= \?/); assert.match(query.sql, /datetime\(work\.created_at\) >= datetime\(\?\)/); assert.match(query.sql, /datetime\(work\.created_at\) < datetime\(\?\)/); assert.match(query.sql, /customer\.first_name\) LIKE \?/); assert.match(query.sql, /customer\.last_name\) LIKE \?/); assert.doesNotMatch(query.sql, /Acme/); }
  assert.match(queries[1].sql, /work\.created_at job_created_at/);
  for (const query of queries) { assert.match(query.sql, /json_extract\(intent\.intent_snapshot, '\$\.program\.claimOutputCode'\) = \?/); assert.ok(query.bindings.includes("VEEC")); }
  queries.length = 0;
  const invalid = await exported.GET(new Request("https://example.test/api/creditex/job-intents?certificateType=invented")); assert.equal(invalid.status, 400); assert.equal(queries.length, 0);
  assert.equal((await exported.GET(new Request(request, { headers: { origin: 'https://other.test' } }))).status, 403); assert.equal(queries.length, 0);
  queries.length = 0; organisationCode = "another-partner";
  assert.equal((await exported.GET(request)).status, 403); assert.equal(queries.length, 0);
});
