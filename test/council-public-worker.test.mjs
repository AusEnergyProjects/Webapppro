import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import * as branding from "../src/lib/council-public-branding.ts";
import * as redirects from "../src/lib/public-redirects.mjs";
import * as release from "../src/lib/release-identity.mjs";

const code = "1234567890abcdef1234567890abcdef";
const host = "https://energy.portphillip.vic.gov.au";
const source = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("worker/index.ts", source, ts.ScriptTarget.Latest, true);
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(t, options = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY);");
  for (const migration of ["0250_council_workspace.sql", "0251_council_profile.sql", "0258_council_public_branding.sql"]) sql.exec(fs.readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  sql.exec(`INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES('one','First Council','first','VIC','now','now');
    INSERT INTO council_postcodes VALUES('one','VIC','3182','admin','now');
    INSERT INTO council_campaigns(id,council_id,code,title,kind,audience,status,created_at,updated_at) VALUES('campaign','one','${code}','Upgrades','campaign','everyone','active','now','now');
    UPDATE council_organisations SET public_journey_enabled=1,public_home_url='https://www.portphillip.vic.gov.au/',public_hostname='energy.portphillip.vic.gov.au',public_hostname_verified_at='now',public_campaign_id='campaign' WHERE id='one';`);
  let dbCalls = 0;
  const calls = [], handled = [], pending = [], errors = [], cacheReads = [], cacheWrites = [], loaded = [];
  const prepare = (query, values = []) => ({ bind: (...bindings) => prepare(query, bindings), first: async () => sql.prepare(query).get(...values) || null });
  const db = { prepare };
  const invoke = name => (...args) => { calls.push({ name, args }); return Promise.resolve(name === "drainTradeMapPreparation" ? { failed: 0 } : undefined); };
  const dependencies = new Map();
  for (const node of parsed.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause) continue;
    const dependency = {};
    const bindings = node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if (binding.isTypeOnly) continue;
      const name = binding.propertyName?.text || binding.name.text;
      dependency[name] = name.endsWith("_HEADER") ? `test-${name.toLowerCase()}` : invoke(name);
    }
    dependencies.set(node.moduleSpecifier.text, dependency);
  }
  dependencies.set("../src/lib/council-public-branding", branding);
  dependencies.set("../src/lib/public-redirects.mjs", redirects);
  dependencies.set("../src/lib/release-identity.mjs", release);
  dependencies.set("../src/lib/council-monthly-report-pdf", { createCouncilMonthlyReportPdf: async bundle => { calls.push({ name: "createCouncilMonthlyReportPdf", args: [bundle] }); return new Uint8Array([1, 2, 3]); } });
  dependencies.get("../src/lib/council-monthly-report-server").hasDueCouncilMonthlyReports = async (...args) => { calls.push({ name: "hasDueCouncilMonthlyReports", args }); return options.reportsDue ?? false; };
  dependencies.get("../db").getD1 = () => { dbCalls++; if (options.dbFailure) throw new Error("Database unavailable"); return db; };
  dependencies.get("../src/lib/service-reminder-delivery").serviceReminderProviderConfiguration = () => ({ email: { configured: false } });
  dependencies.get("../src/lib/creditex-product-registry-maintenance").creditexAutomaticProductRegistryMaintenanceTargets = () => [];
  dependencies.get("../src/lib/opportunity-notification-retry").takeOpportunityNotificationDispatch = response => ({ response, opportunityId: "" });
  dependencies.get("../src/lib/opportunity-notification-retry").shouldDrainOpportunityNotificationBacklog = () => false;
  dependencies.get("../src/lib/public-plan-delivery-retry").takePublicPlanDeliveryDispatch = response => ({ response, intakeId: "" });
  dependencies.get("../src/lib/public-plan-delivery-retry").shouldDrainPublicPlanDeliveryBacklog = () => false;
  dependencies.get("../src/lib/public-plan-quote-photo-cleanup").shouldDrainPublicPlanQuotePhotoCleanup = () => false;
  for (const [path, name] of [["trade-accounting-automation-dispatch", "queueAccountingDispatch"], ["trade-map-preparation", "queueTradeMapPreparation"], ["trade-quote-delivery-dispatch", "queueTradeQuoteDeliveryDispatch"]]) dependencies.get(`../src/lib/${path}`)[name] = response => response;
  dependencies.get("../src/lib/trade-map-maintenance").queueTradeMapMaintenance = (_request, response) => response;
  dependencies.get("vinext/server/app-router-entry").default = { fetch: async request => {
    handled.push(request);
    if (options.handler) return options.handler(request);
    return new Response("Council journey", { headers: { "Content-Type": "text/html", "Set-Cookie": "private-session=value; Secure", "Cache-Control": "public, max-age=600" } });
  } };
  const record = { exports: {} };
  vm.runInNewContext(compiled, { exports: record.exports, module: record, Request, Response, Headers, URL,
    require: name => { assert.ok(dependencies.has(name), name); loaded.push(name); return dependencies.get(name); },
    console: { error: (...args) => errors.push(args) },
    caches: { default: { match: async request => { cacheReads.push(request); return options.cached?.clone(); }, put: async (request, response) => { cacheWrites.push({ request, response }); } } },
  });
  const ctx = { waitUntil: promise => pending.push(promise) };
  return { sql, db, calls, handled, pending, errors, cacheReads, cacheWrites, loaded, dbCalls: () => dbCalls,
    fetch: request => record.exports.default.fetch(request, { APEX_CANONICAL_REDIRECTS_ENABLED: "true" }, ctx),
    schedule: (cron, env = {}) => record.exports.default.scheduled({ cron }, env, ctx),
  };
}

test("verified custom council hosts rewrite only their root and never use platform redirects or shared HTML cache", async t => {
  const f = fixture(t, { cached: new Response("wrong cached council") });
  const response = await f.fetch(new Request(`${host}/?campaign=local`, { headers: { accept: "text/html", cookie: "private=session", authorization: "Bearer private", [branding.COUNCIL_PUBLIC_REFERENCE_HEADER]: "spoofed" } }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Council journey");
  const request = f.handled[0];
  assert.equal(request.url, `${host}/council/program/${code}?campaign=local`);
  assert.equal(request.headers.get(branding.COUNCIL_PUBLIC_REFERENCE_HEADER), code);
  assert.equal(request.headers.has("authorization"), false);
  assert.equal(request.headers.has("cookie"), false);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.has("Location"), false);
  assert.equal(f.cacheReads.length + f.cacheWrites.length, 0);
});

test("platform requests strip spoofed council attribution while retaining current cache and redirects without a council database read", async t => {
  const f = fixture(t, { cached: new Response("cached platform", { headers: { "Content-Type": "text/html" } }) });
  const response = await f.fetch(new Request("https://ausenergyassessments.com/", { headers: { accept: "text/html", [branding.COUNCIL_PUBLIC_REFERENCE_HEADER]: code } }));
  assert.equal(await response.text(), "cached platform");
  assert.equal(f.cacheReads[0].headers.has(branding.COUNCIL_PUBLIC_REFERENCE_HEADER), false);
  assert.equal(f.handled.length, 0);
  assert.equal(f.dbCalls(), 0);
  const redirect = await f.fetch(new Request("https://compare.ausenergyassessments.com/getting-started?test=1"));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("Location"), "https://ausenergyassessments.com/plan?test=1");
});

test("custom host lead submissions preserve their method, body and same-origin URL while replacing client attribution headers", async t => {
  const f = fixture(t, { handler: async request => Response.json({ url: request.url, method: request.method, body: await request.json(), ref: request.headers.get(branding.COUNCIL_PUBLIC_REFERENCE_HEADER), origin: request.headers.get("origin"), authorised: request.headers.has("authorization") }) });
  const input = { enquiry: "quick-upgrade-options", councilReference: code, customerSector: "business" };
  const response = await f.fetch(new Request(`${host}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json", Origin: host, authorization: "private", [branding.COUNCIL_PUBLIC_REFERENCE_HEADER]: "spoofed" }, body: JSON.stringify(input) }));
  assert.deepEqual(await response.json(), { url: `${host}/api/leads`, method: "POST", body: input, ref: code, origin: host, authorised: false });
  assert.equal(f.cacheReads.length, 0);
});

test("database failures deny custom hosts while normal platform API requests retain authentication without trusting attribution", async t => {
  const f = fixture(t, { dbFailure: true, handler: async request => Response.json({ cookie: request.headers.get("cookie"), authorization: request.headers.get("authorization"), reference: request.headers.get(branding.COUNCIL_PUBLIC_REFERENCE_HEADER) }) });
  assert.equal((await f.fetch(new Request(`${host}/`))).status, 404);
  assert.equal(f.handled.length, 0);
  const response = await f.fetch(new Request("https://ausenergyassessments.com/api/private", { headers: { cookie: "session=private", authorization: "Bearer private", [branding.COUNCIL_PUBLIC_REFERENCE_HEADER]: "spoofed" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cookie: "session=private", authorization: "Bearer private", reference: null });
  assert.equal(f.dbCalls(), 1);
  assert.equal(f.cacheReads.length, 0);
});

test("unknown, revoked, cross-council and private paths fail closed before the application or cache", async t => {
  const f = fixture(t);
  for (const url of ["https://unknown-council.vic.gov.au/", `${host}/council`, `${host}/direct-trade/dashboard`, `${host}/api/admin/councils`, `${host}/api/health`, `${host}/getting-started`, `${host}/council/program/${"b".repeat(32)}`]) {
    assert.equal((await f.fetch(new Request(url, { headers: { Host: "ausenergyassessments.com", "X-Forwarded-Host": "ausenergyassessments.com" } }))).status, 404, url);
  }
  assert.equal((await f.fetch(new Request(`${host}/assets/client.js`))).status, 200);
  f.sql.exec("UPDATE council_campaigns SET status='paused'");
  assert.equal((await f.fetch(new Request(`${host}/assets/client.js`))).status, 404);
  assert.equal(f.handled.length, 1);
  assert.equal(f.cacheReads.length, 0);
});

test("idle minute report delivery does not fetch sources or load PDF generation; daily reporting stays attached to the event", async t => {
  const f = fixture(t);
  const store = { put() {}, get() {}, delete() {} };
  await f.schedule("* * * * *", { EVIDENCE: store });
  await Promise.all(f.pending);
  const drain = f.calls.filter(call => call.name === "drainCouncilMonthlyReportEmails");
  assert.equal(drain.length, 1);
  assert.equal(drain[0].args[0].db, f.db);
  assert.equal(drain[0].args[0].artifactStore, store);
  assert.equal(f.calls.some(call => ["runCouncilMonthlyReports", "createCouncilMonthlyReportPdf"].includes(call.name)), false);
  assert.equal(f.loaded.includes("../src/lib/council-monthly-report-pdf"), false);
  await f.schedule("15 20 * * *", { EVIDENCE: store });
  await Promise.all(f.pending);
  const generation = f.calls.filter(call => call.name === "runCouncilMonthlyReports");
  assert.equal(generation.length, 1);
  assert.equal(generation[0].args[0].artifactStore, store);
  assert.equal(generation[0].args[0].db, f.db);
  assert.equal(typeof generation[0].args[0].buildPdf, "function");
  assert.equal(f.loaded.includes("../src/lib/council-monthly-report-pdf"), false);
});

test("minute maintenance continues due monthly generation in a bounded run and only renders after the generator asks", async t => {
  const f = fixture(t, { reportsDue: true });
  const store = { put() {}, get() {}, delete() {} };
  await f.schedule("* * * * *", { EVIDENCE: store });
  await Promise.all(f.pending);
  assert.equal(f.calls.filter(call => call.name === "hasDueCouncilMonthlyReports").length, 1);
  const generations = f.calls.filter(call => call.name === "runCouncilMonthlyReports");
  assert.equal(generations.length, 1);
  assert.equal(generations[0].args[0].artifactStore, store);
  assert.equal(generations[0].args[0].db, f.db);
  assert.equal(f.loaded.includes("../src/lib/council-monthly-report-pdf"), false);
  assert.equal(f.calls.filter(call => call.name === "drainCouncilMonthlyReportEmails").length, 1);
  await generations[0].args[0].buildPdf({ kind: "due-council" });
  assert.equal(f.calls.filter(call => call.name === "createCouncilMonthlyReportPdf").length, 1);
});

test("the monthly PDF runtime is imported only when the due report generator invokes its rendering callback", async t => {
  const f = fixture(t);
  assert.equal(f.loaded.includes("../src/lib/council-monthly-report-pdf"), false);
  await f.schedule("15 20 * * *", { EVIDENCE: { put() {}, get() {}, delete() {} } });
  await Promise.all(f.pending);
  assert.equal(f.loaded.includes("../src/lib/council-monthly-report-pdf"), false);
  const generation = f.calls.find(call => call.name === "runCouncilMonthlyReports");
  const bundle = { kind: "test-council-monthly-report" };
  assert.deepEqual(Array.from(await generation.args[0].buildPdf(bundle)), [1, 2, 3]);
  assert.equal(f.loaded.filter(name => name === "../src/lib/council-monthly-report-pdf").length, 1);
  assert.equal(f.calls.filter(call => call.name === "createCouncilMonthlyReportPdf").length, 1);
  assert.equal(f.calls.find(call => call.name === "createCouncilMonthlyReportPdf").args[0], bundle);
});
