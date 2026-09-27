import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as contract from "../src/lib/trade-solar-design.ts";

const equipment = { id: "panel-440", kind: "panel", name: "Panel 440 W", manufacturer: "Manufacturer", model: "Model 440", quantity: 1, watts: 440, widthM: 1.13, lengthM: 1.72 };
const input = (changes = {}) => ({ title: "Example roof", panels: [{ id: 1, center: { lat: -37.8, lng: 145 }, widthM: 1.13, lengthM: 1.72, lengthTilt: 22.5, widthTilt: 0, heading: 28, equipment }], equipment: [equipment], installationNotes: "Use rear access.", center: { lat: -37.8, lng: 145 }, zoom: 21, customerId: "", workOrderId: "", ...changes });
const owner = (ownerUid = "owner-a", changes = {}) => ({ ownerUid, actorUid: ownerUid, memberId: `${ownerUid}-member`, isOwner: true, canViewQuotes: true, canManageQuotes: true, canViewCustomers: true, canSearchCustomers: true, jobScope: "team", ...changes });
const source = fs.readFileSync(new URL("../src/lib/trade-solar-design-server.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(t) {
  const sql = new DatabaseSync(":memory:"); t.after(() => sql.close());
  sql.exec(`CREATE TABLE trade_crm_customers (id TEXT PRIMARY KEY, firebase_uid TEXT, record_status TEXT);
    CREATE TABLE trade_crm_service_sites (id TEXT PRIMARY KEY, customer_id TEXT, firebase_uid TEXT, record_status TEXT);
    CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT, record_status TEXT, source_type TEXT, assignee_member_id TEXT);
    CREATE TABLE trade_crm_job_details (work_order_id TEXT PRIMARY KEY, firebase_uid TEXT, crm_customer_id TEXT, service_site_id TEXT, customer_source TEXT, accepted_disclosure_sha256 TEXT DEFAULT '', accepted_disclosure_snapshot TEXT DEFAULT '');`);
  sql.exec(fs.readFileSync(new URL("../drizzle/0197_trade_solar_designs.sql", import.meta.url), "utf8"));
  for (const business of ["a", "b"]) {
    sql.prepare("INSERT INTO trade_crm_customers VALUES (?, ?, 'active')").run(`customer-${business}`, `owner-${business}`);
    sql.prepare("INSERT INTO trade_crm_service_sites VALUES (?, ?, ?, 'active')").run(`site-${business}`, `customer-${business}`, `owner-${business}`);
    sql.prepare("INSERT INTO trade_work_orders VALUES (?, ?, 'installer', 'active', 'direct', ?)").run(`job-${business}`, `owner-${business}`, `staff-${business}`);
    sql.prepare("INSERT INTO trade_crm_job_details (work_order_id, firebase_uid, crm_customer_id, service_site_id, customer_source) VALUES (?, ?, ?, ?, 'trade_owned')").run(`job-${business}`, `owner-${business}`, `customer-${business}`, `site-${business}`);
  }
  let beforeWrite;
  const db = { prepare(statement) { return { bind(...values) { return {
    async first() { return sql.prepare(statement).get(...values) ?? null; },
    async all() { return { results: sql.prepare(statement).all(...values) }; },
    async run() { if (beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; hook(); } const result = sql.prepare(statement).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const server = {};
  const dependencies = {
    "../../db": { getD1: () => db },
    "./trade-team-server": { canViewQuotes: access => access.isOwner || access.canViewQuotes, canManageQuotes: access => access.isOwner || access.canManageQuotes },
    "./trade-solar-design": contract,
  };
  Function("require", "exports", compiled)(id => { assert.ok(dependencies[id], id); return dependencies[id]; }, server);
  return { sql, server, beforeWrite(hook) { beforeWrite = hook; } };
}

test("owner isolation applies to lists, load, write and client-supplied ownership", async t => {
  const { server } = fixture(t), access = owner();
  const design = await server.saveSolarDesign(access, { ...input(), ownerUid: "owner-b" }, "design-a", 0);
  assert.deepEqual((await server.loadSolarDesign(access, design.id)).panels, input().panels);
  assert.equal((await server.listSolarDesigns(owner("owner-b"))).designs.length, 0);
  await assert.rejects(server.loadSolarDesign(owner("owner-b"), design.id), /SOLAR_DESIGN_NOT_FOUND/);
  await assert.rejects(server.saveSolarDesign(owner("owner-b"), input(), design.id, 1), /SOLAR_DESIGN_NOT_FOUND/);
  for (const links of [{ customerId: "customer-b" }, { workOrderId: "job-b" }, { workOrderId: "job-a", customerId: "customer-b" }]) {
    await assert.rejects(server.saveSolarDesign(access, input(links), undefined, 0), /SOLAR_DESIGN_CONTEXT_UNAVAILABLE/);
  }
});

test("first-save retries are idempotent and stale edits cannot overwrite another revision", async t => {
  const { server, beforeWrite, sql } = fixture(t), access = owner();
  const design = await server.saveSolarDesign(access, input(), "stable-client-id", 0);
  assert.deepEqual(await server.saveSolarDesign(access, input(), "stable-client-id", 0), design);
  await assert.rejects(server.saveSolarDesign(access, input({ title: "Different" }), design.id, 0), /REVISION_CONFLICT/);
  const changed = await server.saveSolarDesign(access, input({ installationNotes: "New notes" }), design.id, 1);
  assert.equal(changed.revision, 2);
  assert.deepEqual(await server.saveSolarDesign(access, input({ installationNotes: "New notes" }), design.id, 1), changed);
  await assert.rejects(server.saveSolarDesign(access, input(), design.id, 1), /REVISION_CONFLICT/);
  beforeWrite(() => sql.prepare("UPDATE trade_solar_designs SET revision=revision+1 WHERE id=?").run(design.id));
  await assert.rejects(server.saveSolarDesign(access, input(), design.id, 2), /REVISION_CONFLICT/);
  assert.equal((await server.loadSolarDesign(access, design.id)).installationNotes, "New notes");
});

test("attach derives the current job customer and preserves all editable geometry", async t => {
  const { server } = fixture(t), access = owner();
  const design = await server.saveSolarDesign(access, input(), "design-a", 0);
  const linked = await server.attachSolarDesign(access, design.id, 1, "job-a");
  assert.equal(linked.customerId, "customer-a"); assert.equal(linked.workOrderId, "job-a"); assert.equal(linked.revision, 2);
  assert.deepEqual(linked.panels, design.panels); assert.deepEqual(linked.equipment, design.equipment);
  assert.equal(linked.installationNotes, design.installationNotes);
  await assert.rejects(server.attachSolarDesign(access, design.id, 1, "job-a"), /REVISION_CONFLICT/);
});

test("field and own-job staff cannot browse a business's unlinked designs", async t => {
  const { server, sql, beforeWrite } = fixture(t), access = owner();
  const loose = await server.saveSolarDesign(access, input(), "loose", 0);
  const linked = await server.saveSolarDesign(access, input({ workOrderId: "job-a" }), "linked", 0);
  const staff = owner("owner-a", { actorUid: "staff-user", isOwner: false, memberId: "staff-a", jobScope: "own", fieldSessionId: "session-a" });
  await assert.rejects(server.listSolarDesigns(staff), /BROWSE_REQUIRED/);
  await assert.rejects(server.loadSolarDesign(staff, loose.id), /NOT_FOUND/);
  await assert.rejects(server.saveSolarDesign(staff, input(), "staff-loose", 0), /CONTEXT_UNAVAILABLE/);
  assert.equal((await server.listSolarDesigns(staff, { workOrderId: "job-a" })).designs.length, 1);
  assert.equal((await server.loadSolarDesign(staff, linked.id)).id, linked.id);
  beforeWrite(() => sql.prepare("UPDATE trade_work_orders SET assignee_member_id='other' WHERE id='job-a'").run());
  await assert.rejects(server.saveSolarDesign(staff, input({ workOrderId: "job-a" }), linked.id, 1), /NOT_FOUND/);
  assert.equal((await server.listSolarDesigns(staff, { workOrderId: "job-a" })).designs.length, 0);
});

test("protected and archived job context cannot be exposed through retained designs", async t => {
  const { server, sql } = fixture(t), access = owner();
  const design = await server.saveSolarDesign(access, input({ workOrderId: "job-a" }), "linked", 0);
  const alterations = [
    ["UPDATE trade_work_orders SET source_type='opportunity' WHERE id='job-a'", "UPDATE trade_work_orders SET source_type='direct' WHERE id='job-a'"],
    ["UPDATE trade_crm_job_details SET customer_source='platform_private' WHERE work_order_id='job-a'", "UPDATE trade_crm_job_details SET customer_source='trade_owned' WHERE work_order_id='job-a'"],
    ["UPDATE trade_work_orders SET record_status='binned' WHERE id='job-a'", "UPDATE trade_work_orders SET record_status='active' WHERE id='job-a'"],
    ["UPDATE trade_crm_customers SET record_status='binned' WHERE id='customer-a'", "UPDATE trade_crm_customers SET record_status='active' WHERE id='customer-a'"],
    ["UPDATE trade_crm_service_sites SET record_status='binned' WHERE id='site-a'", "UPDATE trade_crm_service_sites SET record_status='active' WHERE id='site-a'"],
  ];
  for (const [hide, restore] of alterations) {
    sql.exec(hide);
    assert.equal((await server.listSolarDesigns(access)).designs.length, 0);
    await assert.rejects(server.loadSolarDesign(access, design.id), /NOT_FOUND/);
    await assert.rejects(server.attachSolarDesign(access, design.id, 1, "job-a"), /NOT_FOUND/);
    sql.exec(restore);
  }
});

test("public lead designs require a retained accepted disclosure", async t => {
  const { server, sql } = fixture(t), access = owner();
  sql.exec("UPDATE trade_work_orders SET source_type='public_lead' WHERE id='job-a'; UPDATE trade_crm_job_details SET customer_source='public_lead_released' WHERE work_order_id='job-a'");
  await assert.rejects(server.saveSolarDesign(access, input({ workOrderId: "job-a" }), "public-design", 0), /CONTEXT_UNAVAILABLE/);
  sql.prepare("UPDATE trade_crm_job_details SET accepted_disclosure_sha256=?, accepted_disclosure_snapshot=? WHERE work_order_id='job-a'").run("a".repeat(64), JSON.stringify({ contract: "tlink-public-lead-accepted-disclosure-v1" }));
  await server.saveSolarDesign(access, input({ workOrderId: "job-a" }), "public-design", 0);
  sql.exec("UPDATE trade_crm_job_details SET accepted_disclosure_snapshot='broken' WHERE work_order_id='job-a'");
  await assert.rejects(server.loadSolarDesign(access, "public-design"), /NOT_FOUND/);
});

test("quote view and management permission are required for design access", async t => {
  const { server } = fixture(t);
  await assert.rejects(server.saveSolarDesign(owner("owner-a", { isOwner: false, canManageQuotes: false }), input(), "blocked", 0), /ACCESS_REQUIRED/);
  await assert.rejects(server.loadSolarDesign(owner("owner-a", { isOwner: false, canViewQuotes: false }), "blocked"), /ACCESS_REQUIRED/);
});

test("title search escapes literal wildcards, retains owner scope and paginates", async t => {
  const { server } = fixture(t), access = owner();
  await server.saveSolarDesign(access, input({ title: "Roof 100%_done\\rear" }), "literal", 0);
  await server.saveSolarDesign(access, input({ title: "Roof 100 percent done rear" }), "plain", 0);
  await server.saveSolarDesign(owner("owner-b"), input({ title: "Roof 100%_done\\rear" }), "foreign-literal", 0);
  for (const search of ["%", "_", "\\", "100%_done\\rear"]) {
    assert.deepEqual((await server.listSolarDesigns(access, { search })).designs.map(design => design.id), ["literal"]);
  }
  assert.equal((await server.listSolarDesigns(access, { search: "roof" })).designs.length, 2);
  for (let i = 0; i < 49; i++) await server.saveSolarDesign(access, input({ title: `Page roof ${i}` }), `page-${i}`, 0);
  const first = await server.listSolarDesigns(access), second = await server.listSolarDesigns(access, { offset: 50 });
  assert.equal(first.designs.length, 50); assert.equal(first.hasMore, true);
  assert.equal(second.designs.length, 1); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.designs, ...second.designs].map(design => design.id)).size, 51);
  await assert.rejects(server.listSolarDesigns(access, { search: "x".repeat(101) }), /SOLAR_DESIGN_INVALID/);
  await assert.rejects(server.listSolarDesigns(access, { offset: -1 }), /SOLAR_DESIGN_INVALID/);
});
