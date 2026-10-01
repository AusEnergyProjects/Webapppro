import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { Miniflare } from "miniflare";
import * as lifecycle from "../src/lib/trade-job-lifecycle.ts";
import * as register from "../src/lib/trade-crm-job-register.ts";
import * as sorts from "../src/lib/trade-crm-register-sort-sql.ts";
import { creditexWholeJobLifecycleSql } from "../src/lib/creditex-job-lifecycle-projection.ts";
import { TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL } from "../src/lib/trade-crm-job-index-sql.ts";
import { jobMemberSql } from "../src/lib/trade-job-collaboration.ts";
import { loadTradeMapDataset, tradeMapAddressSql } from "../src/lib/trade-map-dataset-server.ts";
import { claimTradeMapLocations, saveTradeMapLocations } from "../src/lib/trade-map-location-cache.ts";

const root = new URL("../", import.meta.url);
const route = fs.readFileSync(new URL("src/app/api/trade-crm/route.ts", root), "utf8");
const transpile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const constantsText = route.slice(route.indexOf("const JOB_REGISTER_QUOTE_TOTAL_SQL ="), route.indexOf("const SCHEDULE_SORT ="));
const constantDeps = { ...lifecycle, ...register, ...sorts, creditexWholeJobLifecycleSql };
const constants = new Function(...Object.keys(constantDeps), `${transpile(constantsText)}; return {
  JOB_REGISTER_QUOTE_TOTAL_SQL, JOB_EFFECTIVE_SCHEDULE_SQL, JOB_REGISTER_ASSIGNEE_SEARCH_SQL,
  JOB_REGISTER_LIFECYCLE_SQL, JOB_SORTS
};`)(...Object.values(constantDeps));
const indexText = route.slice(route.indexOf("async function crmIndex("), route.indexOf("async function crmDetail("));
const indexDeps = {
  ...constantDeps, ...constants, TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL, jobMemberSql, tradeMapAddressSql,
  getD1: () => ({}), pagination: () => ({ page: 99, pageSize: 25 }),
  cleanAdminText: (value, limit) => String(value || "").trim().slice(0, limit),
  dateValue: value => value || "", ftsPrefixQuery: value => value,
  SERVICE_CATEGORIES: new Set(["electrical", "plumbing"]),
  PIPELINE_STAGES: new Set(["imported", "enquiry"]), WORK_STAGES: new Set(["imported", "backlog", "completed"]),
  ADDRESS_STATES: new Set(["VIC", "NSW"]), INVOICE_STATUSES: new Set(["paid"]),
  JOB_REGISTER_STATUS_SET: new Set(register.JOB_REGISTER_OPERATIONAL_STATUSES),
};
const crmIndex = new Function(...Object.keys(indexDeps), `${transpile(indexText)}; return crmIndex;`)(...Object.values(indexDeps));
const owner = { uid: "owner", memberId: "member", access: { isOwner: true, jobScope: "team", canViewQuotes: true, canViewInvoices: true } };

function schema() {
  const db = new DatabaseSync(":memory:");
  for (const name of fs.readdirSync(new URL("drizzle/", root)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    for (const statement of fs.readFileSync(new URL(`drizzle/${name}`, root), "utf8").split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) {
      try { db.exec(statement); } catch (error) {
        const fts = statement.match(/^CREATE VIRTUAL TABLE ([a-z_]+) USING fts5\((.*)\);?$/is);
        if (!error.message.includes("no such module: fts5") || !fts) throw error;
        db.exec(`CREATE TABLE ${fts[1]} (${fts[2].split(",").map(value => value.trim()).filter(value => !value.startsWith("tokenize=")).map(value => `${value.split(/\s+/)[0]} text`).join(",")})`);
      }
    }
  }
  return db;
}
const insert = (db, table, values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
const now = "2026-10-01T00:00:00.000Z";
const mapQuery = (resource, filters = "", identity = owner) => crmIndex(identity, new URL(`https://example.test/api/trade-crm?resource=${resource}&${filters}`), resource, true);
const queryRows = (db, query) => db.prepare(query.sql).all(...query.bindings);
const d1 = sqlite => ({
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind: (...values) => ({
      first: async () => statement.get(...values) || null,
      all: async () => ({ results: statement.all(...values) }),
    }) };
  },
});

test("map SQL matches the existing customer address projection and ignores list cursors/page sizes", async () => {
  const db = schema();
  try {
    insert(db, "trade_crm_customers", { id: "c", firebase_uid: "owner", customer_number: "C1", first_name: "Test", address_line_1: " 1 Test Street ", address_line_2: " Unit 2 ", suburb: "Melbourne", address_state: "VIC", postcode: "3000", created_at: now, updated_at: now });
    insert(db, "trade_crm_customers", { id: "other", firebase_uid: "other", customer_number: "C2", first_name: "Other", created_at: now, updated_at: now });
    insert(db, "trade_crm_customers", { id: "archived", firebase_uid: "owner", customer_number: "C3", first_name: "Archived", record_status: "archived", created_at: now, updated_at: now });
    const query = await mapQuery("customers", "cursor=invalid&page=999&pageSize=25");
    assert.deepEqual(queryRows(db, query).map(row => ({ ...row })), [{ id: "c", kind: "customer", title: "Test", reference: "C1", address: "1 Test Street, Unit 2, Melbourne, VIC, 3000, Australia", address_key: "1 test street, unit 2, melbourne, vic, 3000, australia", detail: "Customer", category: "customer" }]);
    assert.equal(queryRows(db, await mapQuery("customers", "firstName=other")).length, 0);
    assert.equal(queryRows(db, await mapQuery("customers", "state=VIC&postcode=3000&street=test")).length, 1);
    db.prepare("UPDATE trade_crm_customers SET address_line_1='' WHERE id='c'").run();
    assert.equal(queryRows(db, query)[0].address, "", "locality alone must not become a customer's precise pin");
  } finally { db.close(); }
});

test("map job dataset preserves assigned visits, Imported, filters and protected customer locations", async () => {
  const db = schema();
  try {
    insert(db, "trade_crm_customers", { id: "customer", firebase_uid: "owner", customer_number: "C", first_name: "Customer", created_at: now, updated_at: now });
    insert(db, "trade_crm_service_sites", { id: "site", firebase_uid: "owner", customer_id: "customer", address_line_1: "5 Test Road", suburb: "Melbourne", address_state: "VIC", postcode: "3000", created_at: now, updated_at: now });
    for (const [id, uid, stage, source, assignee] of [["owned", "owner", "imported", "import", "member"], ["private", "owner", "backlog", "opportunity", "member"], ["unassigned", "owner", "backlog", "direct", "other-member"], ["other", "other", "backlog", "direct", "member"], ["visit", "owner", "backlog", "direct", "other-member"]]) {
      insert(db, "trade_work_orders", { id, firebase_uid: uid, partner_type: "installer", work_number: id, title: "Private source title", stage, source_type: source, assignee_member_id: assignee, service_category: "electrical", created_at: now, updated_at: now });
      insert(db, "trade_crm_job_details", { id, work_order_id: id, firebase_uid: uid, crm_customer_id: "customer", service_site_id: "site", customer_source: source === "opportunity" ? "platform_private" : "trade_owned", pipeline_stage: stage === "imported" ? "imported" : "enquiry", created_at: now, updated_at: now });
    }
    insert(db, "trade_crm_appointments", { id: "visit-slot", firebase_uid: "owner", work_order_id: "visit", assignee_member_id: "member", appointment_type: "site_visit", title: "Visit", starts_at: now, ends_at: now, status: "scheduled", created_at: now, updated_at: now });
    const member = { ...owner, access: { ...owner.access, isOwner: false, jobScope: "own" } };
    const rows = queryRows(db, await mapQuery("jobs", "filter=all", member));
    assert.deepEqual(rows.map(row => row.id).sort(), ["owned", "private", "visit"]);
    const protectedRow = rows.find(row => row.id === "private");
    assert.equal(protectedRow.address, ""); assert.equal(protectedRow.title, "Protected job");
    assert.equal(rows.find(row => row.id === "owned").category, "imported");
    assert.equal(rows.find(row => row.id === "owned").address, "5 Test Road, Melbourne, VIC, 3000, Australia");
    assert.deepEqual(queryRows(db, await mapQuery("jobs", "operationalStatus=imported", member)).map(row => row.id), ["owned"]);
    assert.equal(queryRows(db, await mapQuery("jobs", "filter=all&service=plumbing", member)).length, 0);
    assert.equal(queryRows(db, await mapQuery("jobs", "filter=all&firstName=Customer", member)).length, 2);
    db.prepare("UPDATE trade_work_orders SET record_status='archived' WHERE id='owned'").run();
    assert.equal(queryRows(db, await mapQuery("jobs", "operationalStatus=imported", member)).length, 0);
    await assert.rejects(mapQuery("jobs", "operationalStatus=deleted", member), /JOB_MANAGEMENT_REQUIRED/);
  } finally { db.close(); }
});

test("GET and location mutation paths enforce customer view and search permission together", () => {
  const mapRoute = route.slice(route.indexOf('if (mode === "map"'), route.indexOf('if (mode === "detail"'));
  assert.match(mapRoute, /!identity\.access\.canViewCustomers[\s\S]*!identity\.access\.canSearchCustomers/);
  assert.match(mapRoute, /crmIndex\(identity, url, resource, true\)/);
  const mutation = route.slice(route.indexOf('if (requestedAction === "locate_map_records"'), route.indexOf('const quickQuote ='));
  assert.match(mutation, /!identity\.access\.canViewCustomers[\s\S]*!identity\.access\.canSearchCustomers/);
  assert.match(mutation, /crmIndex\(identity, url, resource, true\)/);
  assert.match(mutation, /locateTradeMapRecords\(db, identity.uid, dataset, \{ limit: body.limit, directory: await getGnafDirectory\(\) \}\)/);
  assert.doesNotMatch(mutation, /body\.results|saveTradeMapLocations/);
  assert.match(route, /error instanceof TradeMapInputError \|\| error instanceof TradeMapLocationInputError/);
});

test("100,000 customers are represented by bounded clusters and sidebar pages, independently of list pagination", async t => {
  const sqlite = schema();
  try {
    sqlite.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 100000)
      INSERT INTO trade_crm_customers(id,firebase_uid,customer_number,first_name,address_line_1,suburb,address_state,postcode,email,private_notes,created_at,updated_at)
      SELECT 'customer-' || n,'owner','C' || n,'Customer ' || n, CASE WHEN n <= 10 THEN '1 Shared Street' ELSE n || ' Sample Street' END,
        'Melbourne','VIC','3000','NEVER-RETURN-EMAIL','NEVER-RETURN-NOTES','${now}','${now}' FROM numbers`);
    const dataset = await mapQuery("customers", "page=2000&pageSize=25&cursor=invalid");
    sqlite.prepare(`WITH source AS (${dataset.sql}) INSERT INTO trade_map_location_cache
      (owner_uid,address_key,address,provider,source_version,source_id,status,lat,lng,approximate,checked_at)
      SELECT 'owner',address_key,MIN(address),'gnaf','gnaf-aug2026','GAVIC'||MIN(id),'located',-38 + (CAST(SUBSTR(MIN(id),10) AS INTEGER) % 200) / 100.0,
        144 + (CAST(SUBSTR(MIN(id),10) AS INTEGER) % 250) / 100.0,0,?
      FROM source GROUP BY address_key`).run(...dataset.bindings, now);
    const url = new URL("https://example.test/api/trade-crm?resource=customers&mapPage=1");
    const customerStarted = performance.now();
    const first = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    t.diagnostic(`100k customer query: ${Math.round(performance.now() - customerStarted)}ms, ${JSON.stringify(first).length} bytes, ${first.markers.length} markers`);
    assert.equal(first.total, 100000); assert.equal(first.mapped, 100000);
    assert.equal(first.inViewport, 100000); assert.equal(first.listTotal, 100000);
    assert.equal(first.pending, 0); assert.equal(first.unmapped, 0);
    assert.equal(first.markers.reduce((sum, value) => sum + value.count, 0), 100000);
    assert.ok(first.markers.length <= 96); assert.equal(first.items.length, 50); assert.equal(first.hasMore, true);
    const encoded = JSON.stringify(first);
    assert.ok(encoded.length < 100000, `${encoded.length} bytes must remain bounded regardless of 100,000 source rows`);
    assert.ok(!encoded.includes("NEVER-RETURN"), "unrequested customer fields must never be sent with map data");
    url.searchParams.set("mapPage", "2");
    const second = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.ok(second.items.every(row => !first.items.some(prior => prior.id === row.id)));
    for (const [key, value] of Object.entries({ north: "-37", south: "-37.5", east: "145", west: "144", mapPage: "1", mapLocationStatus: "located" })) url.searchParams.set(key, value);
    const area = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(area.total, 100000); assert.equal(area.mapped, 100000); assert.ok(area.inViewport > 0 && area.inViewport < 100000);
    assert.equal(area.listTotal, area.inViewport);
    assert.ok(area.items.every(row => row.position.lat >= -37.5 && row.position.lat <= -37 && row.position.lng >= 144 && row.position.lng <= 145));
    url.searchParams.set("mapAddressKey", "1 shared street, melbourne, vic, 3000, australia");
    const shared = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(shared.listTotal, 10); assert.equal(shared.items.length, 10, "same-address selection ignores unrelated viewport");
    assert.equal(shared.hasMore, false);

    const seedStarted = performance.now();
    sqlite.exec(`INSERT INTO trade_crm_service_sites(id,firebase_uid,customer_id,address_line_1,suburb,address_state,postcode,created_at,updated_at)
      SELECT 'site-' || id,firebase_uid,id,address_line_1,suburb,address_state,postcode,created_at,updated_at FROM trade_crm_customers;
      INSERT INTO trade_work_orders(id,firebase_uid,partner_type,work_number,title,stage,service_category,created_at,updated_at)
      SELECT 'job-' || id,firebase_uid,'installer','J-' || customer_number,'Job ' || customer_number,
        CASE WHEN CAST(SUBSTR(id,10) AS INTEGER) % 2 = 0 THEN 'imported' ELSE 'backlog' END,'electrical',created_at,updated_at FROM trade_crm_customers;
      INSERT INTO trade_crm_job_details(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source,pipeline_stage,created_at,updated_at)
      SELECT 'detail-' || id,'job-' || id,firebase_uid,id,'site-' || id,'trade_owned',
        CASE WHEN CAST(SUBSTR(id,10) AS INTEGER) % 2 = 0 THEN 'imported' ELSE 'enquiry' END,created_at,updated_at FROM trade_crm_customers;`);
    const jobDataset = await mapQuery("jobs", "filter=all&operationalStatus=imported");
    t.diagnostic(`100k jobs seed: ${Math.round(performance.now() - seedStarted)}ms`);
    const jobsStarted = performance.now();
    const jobs = await loadTradeMapDataset(d1(sqlite), "owner", jobDataset, new URL("https://example.test/api/trade-crm?resource=jobs"), now);
    assert.equal(jobs.total, 50000); assert.equal(jobs.mapped, 50000); assert.equal(jobs.inViewport, 50000);
    assert.equal(jobs.items.length, 50); assert.ok(jobs.items.every(row => row.jobStatus === "imported"));
    assert.ok(jobs.markers.every(value => value.category === "imported"));
    assert.ok(jobs.markers.length <= 96);
    t.diagnostic(`100k job source / 50k Imported query: ${Math.round(performance.now() - jobsStarted)}ms, ${JSON.stringify(jobs).length} bytes, ${jobs.markers.length} markers`);
  } finally { sqlite.close(); }
});

test("missing, failed, legacy Google, changed and cross-owner cached addresses cannot become valid pins", async () => {
  const sqlite = schema();
  try {
    for (const name of ["located", "approximate", "missing", "legacy-google", "failed", "error", "changed", "cross-owner"]) {
      insert(sqlite, "trade_crm_customers", { id: name, firebase_uid: "owner", customer_number: name, first_name: name,
        address_line_1: name === "missing" ? "" : `1 ${name} Street`, suburb: "Melbourne", address_state: "VIC", postcode: "3000", created_at: now, updated_at: now });
      if (name === "missing") continue;
      const address = `1 ${name} Street, Melbourne, VIC, 3000, Australia`;
      const located = name !== "failed" && name !== "error";
      insert(sqlite, "trade_map_location_cache", { owner_uid: name === "cross-owner" ? "other" : "owner", address_key: address.toLowerCase(), address,
        provider: name === "legacy-google" ? "google" : "gnaf", source_version: name === "legacy-google" ? "" : "gnaf-aug2026", source_id: name === "legacy-google" || !located ? "" : "GAVIC" + name,
        status: located ? "located" : name === "error" ? "error" : "unlocated", lat: located ? -37.8 : null, lng: located ? 144.9 : null,
        approximate: name === "approximate" ? 1 : 0, expires_at: name === "legacy-google" ? "2026-10-29T00:00:00.000Z" : "" });
    }
    sqlite.prepare("UPDATE trade_crm_customers SET address_line_1='2 Changed Street' WHERE id='changed'").run();
    const dataset = await mapQuery("customers");
    const url = new URL("https://example.test/api/trade-crm?resource=customers");
    const result = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(result.total, 8); assert.equal(result.mapped, 2); assert.equal(result.approximate, 1);
    assert.equal(result.unmapped, 2); assert.equal(result.pending, 4);
    assert.deepEqual(result.items.filter(row => row.position).map(row => row.id), ["approximate", "located"]);
    url.searchParams.set("mapLocationStatus", "pending");
    const pending = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(pending.listTotal, 4); assert.ok(pending.items.every(row => row.locationStatus === "pending"));
    url.searchParams.set("mapLocationStatus", "approximate");
    assert.deepEqual((await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now)).items.map(row => row.id), ["approximate"]);
    url.searchParams.set("mapLocationStatus", "unlocated");
    assert.deepEqual((await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now)).items.map(row => row.id), ["failed", "missing"]);
    url.searchParams.set("mapPage", "999");
    const beyond = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(beyond.listTotal, 2); assert.equal(beyond.items.length, 0); assert.equal(beyond.hasMore, false);
  } finally { sqlite.close(); }
});

test("map request rejects incomplete, non-finite or oversized viewport and pagination inputs before querying", async () => {
  for (const query of ["north=0", "north=NaN&south=-40&east=150&west=140", "north=91&south=-40&east=150&west=140", "north=-40&south=-30&east=150&west=140", "mapPage=0", "mapPage=1e4", "mapPage=1000001", "mapLocationStatus=bogus", `mapAddressKey=${"x".repeat(1001)}`]) {
    await assert.rejects(loadTradeMapDataset({}, "owner", { sql: "SELECT 1", bindings: [] }, new URL(`https://example.test/?${query}`), now), /Map /);
  }
});

test("co-located jobs preserve counts, canonical and mixed lifecycle categories, and approximate locations", async () => {
  const sqlite = schema();
  try {
    insert(sqlite, "trade_crm_customers", { id: "customer", firebase_uid: "owner", customer_number: "C1", first_name: "Customer", created_at: now, updated_at: now });
    for (const [id, street, approximate] of [["site-a", "1 Sample Street", 0], ["site-b", "2 Sample Street", 1]]) {
      insert(sqlite, "trade_crm_service_sites", { id, firebase_uid: "owner", customer_id: "customer", address_line_1: street,
        suburb: "Melbourne", address_state: "VIC", postcode: "3000", created_at: now, updated_at: now });
      const address = `${street}, Melbourne, VIC, 3000, Australia`;
      insert(sqlite, "trade_map_location_cache", { owner_uid: "owner", address_key: address.toLowerCase(), address, provider: "gnaf", source_version: "gnaf-aug2026", source_id: "GAVIC" + id, status: "located",
        lat: -37.8, lng: 144.9, approximate, checked_at: now, expires_at: "" });
    }
    for (const id of ["job-a", "job-b"]) {
      insert(sqlite, "trade_work_orders", { id, firebase_uid: "owner", partner_type: "installer", work_number: id,
        title: id, stage: "imported", created_at: now, updated_at: now });
      insert(sqlite, "trade_crm_job_details", { id, work_order_id: id, firebase_uid: "owner", crm_customer_id: "customer",
        service_site_id: "site-a", customer_source: "trade_owned", pipeline_stage: "imported", created_at: now, updated_at: now });
    }
    const dataset = await mapQuery("jobs", "filter=all");
    const url = new URL("https://example.test/api/trade-crm?resource=jobs");
    const same = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(same.total, 2); assert.equal(same.mapped, 2); assert.equal(same.inViewport, 2);
    assert.equal(same.markers.length, 1); assert.equal(same.markers[0].count, 2);
    assert.equal(same.markers[0].category, "imported"); assert.equal(same.markers[0].approximate, false);
    assert.equal(same.markers[0].addressKey, "1 sample street, melbourne, vic, 3000, australia");
    assert.equal(same.items.length, 2);

    sqlite.exec("UPDATE trade_work_orders SET stage='backlog' WHERE id='job-b'; UPDATE trade_crm_job_details SET pipeline_stage='enquiry' WHERE work_order_id='job-b'");
    const mixed = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(mixed.markers.length, 1); assert.equal(mixed.markers[0].category, "mixed");
    assert.equal(mixed.markers[0].count, 2);
    assert.deepEqual(mixed.items.map(row => row.jobStatus).sort(), ["imported", "unscheduled"]);

    sqlite.exec("UPDATE trade_crm_job_details SET service_site_id='site-b' WHERE work_order_id='job-b'");
    const distinct = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(distinct.total, 2); assert.equal(distinct.mapped, 2); assert.equal(distinct.approximate, 1);
    assert.equal(distinct.markers.length, 1); assert.equal(distinct.markers[0].count, 2);
    assert.equal(distinct.markers[0].category, "mixed"); assert.equal(distinct.markers[0].approximate, true);
    assert.equal(distinct.markers[0].addressKey, undefined, "different addresses at one coordinate must not select only one address");
    assert.equal(new Set(distinct.items.map(row => row.addressKey)).size, 2);
    assert.deepEqual(distinct.items.map(row => row.position), [{ lat: -37.8, lng: 144.9 }, { lat: -37.8, lng: 144.9 }]);

    sqlite.exec("UPDATE trade_work_orders SET stage='backlog' WHERE id='job-a'; UPDATE trade_crm_job_details SET pipeline_stage='enquiry' WHERE work_order_id='job-a'");
    const canonical = await loadTradeMapDataset(d1(sqlite), "owner", dataset, url, now);
    assert.equal(canonical.markers[0].category, "unscheduled"); assert.equal(canonical.markers[0].count, 2);
    assert.equal(canonical.listTotal, 2); assert.equal(canonical.items.length, 2);
  } finally { sqlite.close(); }
});

test("real Cloudflare D1 accepts the complete lifecycle-filtered map and claim/save query plans", async () => {
  const sqlite = schema();
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: "2026-05-01", d1Databases: ["DB"] });
  try {
    const db = await mf.getD1Database("DB");
    const statements = sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type='index'").all();
    for (let offset = 0; offset < statements.length; offset += 20) await db.batch(statements.slice(offset, offset + 20).map(row => db.prepare(row.sql)));
    await db.prepare("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,work_number,title,stage,created_at,updated_at) VALUES('job','owner','installer','J1','Map job','imported',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO trade_crm_customers(id,firebase_uid,customer_number,first_name,created_at,updated_at) VALUES('customer','owner','C1','Test',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO trade_crm_service_sites(id,firebase_uid,customer_id,address_line_1,suburb,address_state,postcode,created_at,updated_at) VALUES('site','owner','customer','1 Test Street','Melbourne','VIC','3000',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO trade_crm_job_details(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source,pipeline_stage,created_at,updated_at) VALUES('details','job','owner','customer','site','trade_owned','imported',?,?)").bind(now, now).run();
    const dataset = await mapQuery("jobs", "operationalStatus=imported");
    const url = new URL("https://example.test/api/trade-crm?resource=jobs&operationalStatus=imported");
    const initial = await loadTradeMapDataset(db, "owner", dataset, url, now);
    assert.equal(initial.total, 1); assert.equal(initial.pending, 1); assert.equal(initial.items[0].jobStatus, "imported");
    const claimed = await claimTradeMapLocations(db, "owner", dataset, { now });
    assert.equal(claimed.claims.length, 1);
    const saved = await saveTradeMapLocations(db, "owner", dataset, claimed.claims.map(claim => ({ ...claim, result: { status: "located", position: { lat: -37.8, lng: 144.9 }, approximate: true, sourceId: "GAVIC123" } })), { now, sourceVersion: "gnaf-aug2026" });
    assert.equal(saved.saved, 1);
    const located = await loadTradeMapDataset(db, "owner", dataset, url, now);
    assert.equal(located.mapped, 1); assert.equal(located.markers.length, 1); assert.equal(located.markers[0].record.id, "job");
    assert.equal((await claimTradeMapLocations(db, "owner", dataset, { now })).claims.length, 0, "reopening must not cause another address lookup");
  } finally { sqlite.close(); await mf.dispose(); }
});
