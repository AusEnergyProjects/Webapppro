import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0030_gifted_white_tiger.sql");
const route = read("../src/app/api/admin/form-templates/route.ts");
const portal = read("../src/components/AdminFormTemplates.tsx");
const sync = read("../src/app/api/trade-team/sync/route.ts");
const database = read("../mobile/src/lib/database.ts");

test("governed form versions are durable, unique and migration safe", () => {
  assert.match(schema, /sqliteTable\("trade_form_templates"/);
  assert.match(schema, /trade_form_templates_key_version_idx/);
  assert.match(schema, /revision: integer\("revision"\)\.notNull\(\)\.default\(1\)/);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_job_forms (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  db.prepare(`INSERT INTO trade_form_templates
    (id, template_key, version, name, jurisdiction, categories, description, guidance, fields, source_notes, status, created_by_uid, created_at, updated_at)
    VALUES ('1', 'test-form', 1, 'Test', 'AU', '["other"]', 'Purpose', 'Guidance', '[]', 'Reviewed', 'draft', 'admin', 'now', 'now')`).run();
  assert.throws(() => db.prepare(`INSERT INTO trade_form_templates
    (id, template_key, version, name, jurisdiction, categories, description, guidance, fields, source_notes, status, created_by_uid, created_at, updated_at)
    VALUES ('2', 'test-form', 1, 'Duplicate', 'AU', '["other"]', 'Purpose', 'Guidance', '[]', 'Reviewed', 'draft', 'admin', 'now', 'now')`).run());
});

test("form publishing is role protected, validated and auditable", () => {
  assert.match(route, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(route, /sourceNotes/);
  assert.match(route, /writeAdminAudit/);
  assert.match(route, /status = 'published'/);
  assert.match(route, /status = 'withdrawn'/);
  assert.match(portal, /Published versions are immutable/);
  assert.match(portal, /Clone next version/);
});

test("offline forms keep snapshots, privacy checks and conflict safe coalescing", () => {
  assert.match(sync, /template_snapshot/);
  assert.match(sync, /save_job_form/);
  assert.match(sync, /PROTECTED_CUSTOMER_DATA/);
  assert.match(sync, /FORM_LOCKED/);
  assert.match(sync, /REVISION_CONFLICT/);
  assert.match(database, /existing\.action\.baseRevision/);
  assert.match(database, /status IN \('queued', 'retry'\)/);
});

test("new form governance copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${portal}\n${sync}`, /[\u2013\u2014]/);
});
