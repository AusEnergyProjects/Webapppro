import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0028_fearless_white_queen.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const platform = read("../src/app/platform/page.tsx");
const membership = read("../src/app/direct-trade/membership/page.tsx");

test("job templates are durable, owner scoped and uniquely named", () => {
  assert.match(schema, /sqliteTable\("trade_crm_job_templates"/);
  assert.match(schema, /trade_crm_job_templates_owner_name_idx/);
  assert.match(route, /CRM_TEMPLATE_LIMIT = 60/);
  assert.match(route, /WHERE firebase_uid = \? AND record_status = 'active'/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \? AND record_status = 'active'/);
});

test("the job template migration applies cleanly", () => {
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(indexes, ["trade_crm_job_templates_owner_idx", "trade_crm_job_templates_owner_name_idx"]);
});

test("templates prefill jobs and copy up to 24 checklist tasks", () => {
  assert.match(route, /action === "create_template"/);
  assert.match(route, /action === "archive_template"/);
  assert.match(route, /cleanTemplateTasks\(storedList\(template\.task_titles, 24\)\)/);
  assert.match(route, /templateTasks\.map/);
  assert.match(crm, /Templates/);
  assert.match(crm, /Start from a template, optional/);
  assert.match(crm, /Checklist, one item per line/);
});

test("public access copy makes free and paid boundaries explicit", () => {
  assert.match(platform, /Always free/);
  assert.match(platform, /No free installer receives leads/);
  assert.match(platform, /Unpaid wholesaler products stay invisible/);
  assert.match(membership, /Nothing is locked behind a household subscription/);
  assert.match(membership, /No household opportunities/);
  assert.match(membership, /Products stay invisible to installers/);
});

test("new customer-facing copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${crm}\n${platform}\n${membership}`, /[\u2013\u2014]/);
});
