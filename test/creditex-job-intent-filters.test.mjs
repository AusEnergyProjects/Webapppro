import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as filters from "../src/lib/creditex-job-intent-filters.ts";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE intent (id TEXT, compliance_organisation_id TEXT, program_code TEXT, registry_activity_code TEXT, intent_snapshot TEXT, planned_start TEXT, updated_at TEXT);
    CREATE TABLE work (id TEXT, work_number TEXT, title TEXT, stage TEXT, priority TEXT);
    CREATE TABLE details (id TEXT, quote_status TEXT, invoice_status TEXT);
    CREATE TABLE customer (id TEXT, business_name TEXT, first_name TEXT, last_name TEXT, customer_number TEXT);
    CREATE TABLE site (id TEXT, address_line_1 TEXT, address_line_2 TEXT, suburb TEXT, address_state TEXT, postcode TEXT);
    CREATE TABLE account (id TEXT, business_name TEXT);`);
  for (const row of [
    ["a", "org", "VEU", "2026-09-21T08:00:00", "completed", "low", "Zoe", "A Plumbing", "Sydney"],
    ["b", "org", "STC", "2026-09-22T08:00:00", "scheduled", "urgent", "Amy", "B Solar", "Melbourne"],
    ["c", "org", "VEU", "2026-09-23T08:00:00", "scheduled", "high", "Ben", "A Plumbing", "Sydney"],
    ["d", "org", "VEU", "", "scheduled", "standard", "Amy", "100%_\\ Trade", "Melbourne"],
    ["e", "other", "VEU", "2026-09-22T08:00:00", "scheduled", "urgent", "Private", "Other", "Sydney"],
  ]) {
    const [id, org, program, date, stage, priority, name, installer, suburb] = row;
    database.prepare("INSERT INTO intent VALUES (?,?,?,?,?,?,?)").run(id, org, program, "6", JSON.stringify({ activity: { title: "Heat pump" } }), date, "2026-09-20");
    database.prepare("INSERT INTO work VALUES (?,?,?,?,?)").run(id, `JOB-${id}`, "Heat pump installation", stage, priority);
    database.prepare("INSERT INTO details VALUES (?,?,?)").run(id, id === "a" ? "accepted" : "draft", id === "a" ? "sent" : "none");
    database.prepare("INSERT INTO customer VALUES (?,?,?,?,?)").run(id, "", name, "Customer", `C-${id}`);
    database.prepare("INSERT INTO site VALUES (?,?,?,?,?,?)").run(id, "1 Main Street", "", suburb, "VIC", "3000");
    database.prepare("INSERT INTO account VALUES (?,?)").run(id, installer);
  }
  const query = values => {
    const options = filters.creditexJobIntentFilters(new URLSearchParams(values));
    const from = `FROM intent JOIN work ON work.id=intent.id JOIN details ON details.id=intent.id JOIN customer ON customer.id=intent.id JOIN site ON site.id=intent.id JOIN account ON account.id=intent.id WHERE intent.compliance_organisation_id=? ${options.filterSql}`;
    const bindings = ["org", ...options.filterBindings];
    return { ids: database.prepare(`SELECT intent.id ${from} ORDER BY ${options.sortSql}`).all(...bindings).map(row => row.id), count: database.prepare(`SELECT count(*) AS n ${from}`).get(...bindings).n };
  };
  return { query, close: () => database.close() };
}

test("combined program, installer, stage, priority and inclusive dates filter the same rows and total", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.query({ program: "VEU", installer: "Plumbing", jobStage: "scheduled", priority: "high", plannedFrom: "2026-09-23", plannedTo: "2026-09-23" }), { ids: ["c"], count: 1 });
    assert.deepEqual(f.query({ plannedFrom: "2026-09-21", plannedTo: "2026-09-22" }), { ids: ["a", "b"], count: 2 });
    assert.deepEqual(f.query({ plannedTo: "2026-09-23" }), { ids: ["a", "b", "c"], count: 3 });
    assert.deepEqual(f.query({ job: "JOB-a", quoteStatus: "accepted", invoiceStatus: "sent" }), { ids: ["a"], count: 1 });
  } finally { f.close(); }
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
  for (const values of [{ plannedFrom: "2026-02-30" }, { plannedTo: "nonsense" }, { plannedFrom: "2026-09-22", plannedTo: "2026-09-21" }]) assert.throws(() => filters.creditexJobIntentFilters(new URLSearchParams(values)), filters.CreditexQueueFilterError);
});

test("route applies identical filter bindings to count and page query while retaining Creditex access checks", async () => {
  const source = fs.readFileSync(new URL("../src/app/api/creditex/job-intents/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const queries = []; let organisationCode = "creditex";
  class AccessError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
  const database = { prepare: sql => ({ bind: (...bindings) => { const entry = { sql, bindings }; queries.push(entry); return { first: async () => ({ total: 76 }), all: async () => ({ results: [] }) }; } }) };
  const dependencies = { "../../../../../db": { getD1: () => database }, "@/lib/compliance-access-server": { ComplianceAccessError: AccessError, requireComplianceAccess: async () => ({ organisationCode, organisationId: "authorised-org" }) }, "@/lib/trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE: "creditex" }, "@/lib/creditex-job-intent-filters": filters };
  const exported = {};
  Function("require", "exports", compiled)(name => { assert.ok(dependencies[name]); return dependencies[name]; }, exported);
  const request = new Request("https://example.test/api/creditex/job-intents?program=VEU&installer=Acme&plannedFrom=2026-09-21&sort=priority&sortDirection=desc&page=2");
  const response = await exported.GET(request); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.total, 76); assert.equal(result.page, 2); assert.equal(result.sort, "priority");
  assert.equal(queries.length, 2); assert.deepEqual(queries[1].bindings.slice(0, -2), queries[0].bindings); assert.deepEqual(queries[1].bindings.slice(-2), [75, 75]);
  assert.equal(queries[0].bindings[0], "authorised-org");
  for (const query of queries) { assert.match(query.sql, /intent\.program_code = \?/); assert.match(query.sql, /account\.business_name\) LIKE \?/); assert.match(query.sql, /substr\(intent\.planned_start, 1, 10\) >= \?/); assert.doesNotMatch(query.sql, /Acme/); }
  queries.length = 0; organisationCode = "another-partner";
  assert.equal((await exported.GET(request)).status, 403); assert.equal(queries.length, 0);
});
