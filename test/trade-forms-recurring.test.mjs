import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeTradeFormAnswers, tradeFormCompletion, tradeFormTemplate, tradeFormTemplatesFor } from "../src/lib/trade-form-library.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0029_busy_deathstrike.sql");
const formsRoute = read("../src/app/api/trade-job-forms/route.ts");
const recurringServer = read("../src/lib/trade-recurring-jobs-server.ts");
const lifecycleRoute = read("../src/app/api/trade-asset-lifecycle/route.ts");
const lifecycleUi = read("../src/components/TradeAssetLifecycle.tsx");
const formsUi = read("../src/components/TradeJobFormsPanel.tsx");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");
const mobileJob = read("../mobile/src/app/job/[id].tsx");
const worker = read("../worker/index.ts");
const vite = read("../vite.config.ts");

test("the form library is work-type specific, versioned and explicit about legal boundaries", () => {
  const battery = tradeFormTemplatesFor("battery");
  assert.ok(battery.some((item) => item.key === "electrical-commissioning-support"));
  assert.ok(battery.some((item) => item.key === "pre-start-risk-readiness"));
  assert.ok(battery.every((item) => item.version === 1 && item.jurisdiction === "AU"));
  assert.ok(battery.every((item) => /does not replace|remain the responsibility|required for/i.test(item.guidance)));
  assert.equal(tradeFormTemplate("hot-water-commissioning-support", 1, "solar"), null);
});

test("form answer normalisation is bounded and completion requires checked confirmations", () => {
  const template = tradeFormTemplate("service-visit-support", 1, "other");
  assert.ok(template);
  const answers = normalizeTradeFormAnswers(template, { work_date: " 2026-07-16 ", technician: "A".repeat(300), site_safe: "yes" });
  assert.equal(answers.work_date, "2026-07-16");
  assert.equal(answers.technician.length, 100);
  assert.equal(answers.site_safe, false);
  assert.equal(tradeFormCompletion(template, answers).ready, false);
  const complete = Object.fromEntries(template.fields.map((field) => [field.key, field.type === "checkbox" ? true : "recorded"]));
  assert.equal(tradeFormCompletion(template, complete).ready, true);
  assert.equal(normalizeTradeFormAnswers(template, { work_date: "16/07/2026" }).work_date, "");
  assert.equal(normalizeTradeFormAnswers(template, { work_date: "2026-02-30" }).work_date, "");
});

test("forms and recurring generation records are durable and uniqueness protected", () => {
  assert.match(schema, /sqliteTable\("tradeJobForms"|sqliteTable\("trade_job_forms"/);
  assert.match(schema, /trade_job_forms_work_template_idx/);
  assert.match(schema, /trade_service_job_generations_plan_due_idx/);
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_asset_service_plans (
    id text PRIMARY KEY NOT NULL, asset_id text NOT NULL, service_type text NOT NULL,
    cadence_months integer NOT NULL, next_due_at text NOT NULL, status text NOT NULL,
    firebase_uid text NOT NULL, work_order_id text NOT NULL, updated_at text NOT NULL
  )`);
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  db.prepare(`INSERT INTO trade_service_job_generations
    (id, service_plan_id, source_work_order_id, generated_work_order_id, firebase_uid, due_at, created_at)
    VALUES ('1', 'plan', 'source', 'job', 'owner', '2026-08-01', 'now')`).run();
  assert.throws(() => db.prepare(`INSERT INTO trade_service_job_generations
    (id, service_plan_id, source_work_order_id, generated_work_order_id, firebase_uid, due_at, created_at)
    VALUES ('2', 'plan', 'source', 'job-2', 'owner', '2026-08-01', 'later')`).run());
});

test("job forms enforce assignment scope, paid operations and privacy-safe evidence", () => {
  assert.match(formsRoute, /requireInstallerTeamAccess\(request, false\)/);
  assert.match(formsRoute, /assignedJob\(access, workOrderId\)/);
  assert.match(formsRoute, /FULL_ACCESS_REQUIRED/);
  assert.match(formsRoute, /containsPrivateData\(answers\)/);
  assert.match(formsRoute, /row\.status === "complete"/);
  assert.match(formsRoute, /row\.template_key === "service-visit-support"/);
  assert.match(formsRoute, /addMonthsToIsoDate/);
  assert.match(formsRoute, /INSERT INTO trade_asset_service_events/);
  assert.match(formsRoute, /template_snapshot/);
  assert.match(formsRoute, /jobSyncChangeStatements/);
  assert.doesNotMatch(formsRoute, /customer_email|customer_phone|address_line_1/i);
});

test("recurring jobs use system numbers, a due-date ledger and protected customer boundaries", () => {
  assert.match(recurringServer, /nextTradeWorkNumber/);
  assert.match(recurringServer, /INSERT OR IGNORE INTO trade_service_job_generations/);
  assert.match(recurringServer, /generated_work_order_id = ''[\s\S]*-30 minutes/);
  assert.match(recurringServer, /source_type, source_reference, work_number/);
  assert.match(recurringServer, /'recurring_service'/);
  assert.match(recurringServer, /protectedJob \? "" : String\(row\.crm_customer_id/);
  assert.match(recurringServer, /platform_private/);
  assert.match(recurringServer, /service-visit-support/);
  assert.match(recurringServer, /jobSyncChangeStatements/);
  assert.doesNotMatch(recurringServer, /customer_email|customer_phone|address_line/i);
});

test("schedule automation has daily and manual controls without duplicate entry points", () => {
  assert.match(vite, /triggers: \{ crons: \["15 20 \* \* \*"\] \}/);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /generateDueServiceJobs/);
  assert.match(lifecycleRoute, /action === "generate_due_jobs"/);
  assert.match(lifecycleRoute, /auto_create_enabled/);
  assert.match(lifecycleUi, /Create recurring jobs automatically/);
  assert.match(lifecycleUi, /protected against duplicates/);
});

test("web and native field interfaces expose forms progressively", () => {
  assert.match(formsUi, /Available for this work type/);
  assert.match(formsUi, /do not replace licences, permits, formal certificates/);
  assert.match(formsUi, /Check and complete/);
  assert.match(syncRoute, /FROM trade_job_forms f JOIN trade_work_orders/);
  assert.match(syncRoute, /forms: formRows\.results/);
  assert.match(mobileJob, /Technical records/);
  assert.match(mobileJob, /with or without reception/);
  assert.match(mobileJob, /save_job_form/);
});

test("new field form and recurring job copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${formsRoute}\n${recurringServer}\n${lifecycleRoute}\n${lifecycleUi}\n${formsUi}\n${mobileJob}`, /[\u2013\u2014]/);
});
