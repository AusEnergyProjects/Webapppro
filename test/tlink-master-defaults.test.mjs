import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as builtins from "../src/lib/trade-form-library.mjs";
import { fieldTransitionExpectedStatus } from "../src/lib/trade-field-completion-policy.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpileModule(read("../src/lib/trade-form-templates-server.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleRecord = { exports: {} };
new Function("require", "module", "exports", compiled)((id) => {
  if (id === "@/lib/trade-form-library.mjs") return builtins;
  if (id === "../../db") return { getD1() { throw new Error("Test database required"); } };
  throw new Error(`Unexpected dependency ${id}`);
}, moduleRecord, moduleRecord.exports);

test("business libraries isolate owners and drafts cannot hide the current master", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_form_templates (template_key TEXT, version INTEGER, name TEXT, jurisdiction TEXT,
    categories TEXT, description TEXT, guidance TEXT, fields TEXT, status TEXT, scope_owner_uid TEXT)`);
  const insert = (key, version, status, owner = "") => db.prepare("INSERT INTO trade_form_templates VALUES (?, ?, ?, 'AU', '[\"other\"]', 'Purpose', 'Instructions', '[]', ?, ?)").run(key, version, key, status, owner);
  insert("service-visit-support", 1, "published"); insert("service-visit-support", 2, "draft");
  insert("business-a", 1, "published", "owner-a"); insert("business-b", 1, "published", "owner-b");
  const d1 = { prepare(sql) { return { bind(...values) { return { async all() { return { results: db.prepare(sql).all(...values) }; } }; } }; } };
  const list = (owner) => moduleRecord.exports.publishedTradeFormTemplatesFor("other", d1, owner);
  const a = await list("owner-a"); const b = await list("owner-b");
  assert.equal(a.find((form) => form.key === "service-visit-support").version, 1);
  assert.ok(a.some((form) => form.key === "business-a")); assert.ok(!a.some((form) => form.key === "business-b"));
  assert.ok(b.some((form) => form.key === "business-b")); assert.ok(!b.some((form) => form.key === "business-a"));
  insert("service-visit-support", 3, "withdrawn");
  assert.ok(!(await list("owner-a")).some((form) => form.key === "service-visit-support"), "Withdrawal must suppress older versions and built-ins");
  assert.equal(a.find((form) => form.key === "service-visit-support").version, 1, "A previously attached snapshot does not mutate");
  db.close();
});

test("master publication rejects a stale draft behind a withdrawn head and a lost compare-and-save", () => {
  const server = read("../src/lib/creditex-activity-work-pack-server.ts");
  const body = server.slice(server.indexOf("export async function publishCreditexWorkPackVersion"));
  const sql = /database\.prepare\(`(UPDATE\s+compliance_activity_work_pack_versions[\s\S]*?)`\)/.exec(body)?.[1];
  assert.ok(sql, "Exercise the actual publication UPDATE");
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE compliance_activity_work_pack_versions (id TEXT, organisation_id TEXT, activity_version_id TEXT,
    version INTEGER, publish_state TEXT, schema_sha256 TEXT, reviewed_by_uid TEXT, reviewed_at TEXT, review_note TEXT);
    INSERT INTO compliance_activity_work_pack_versions VALUES
      ('v1','org','activity',1,'published','hash','','',''),('v2','org','activity',2,'draft','hash','','',''),
      ('v3','org','activity',3,'withdrawn','hash','','',''),('v4','org','activity',4,'draft','hash','','',''),
      ('v5','org','activity',5,'draft','hash','','','');`);
  const publish = (id, predecessor) => Number(db.prepare(sql).run("editor", "now", "Source checked", id, "org", "hash", predecessor, predecessor).changes);
  assert.equal(publish("v2", "v1"), 0); assert.equal(publish("v2", "v3"), 0);
  assert.equal(publish("v4", "v3"), 1); assert.equal(publish("v5", "v3"), 0); assert.equal(publish("v5", "v4"), 1);
  db.close();
});

test("completion accepts real active states without reopening completed or cancelled work", () => {
  for (const state of ["scheduled", "en_route", "arrived", "in_progress"]) assert.equal(fieldTransitionExpectedStatus("finish", state, "in_progress"), state);
  for (const state of ["completed", "cancelled", "unknown"]) assert.notEqual(fieldTransitionExpectedStatus("finish", state, "in_progress"), state);
  assert.equal(fieldTransitionExpectedStatus("arrive", "scheduled", "en_route"), "en_route");
});
