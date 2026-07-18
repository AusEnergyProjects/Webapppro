import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("db/schema.ts");
const migration = read("drizzle/0071_job_execution_progress.sql");
const quoteRoute = read("src/app/api/trade-quotes/route.ts");
const snapshotServer = read("src/lib/trade-quote-execution-server.ts");
const executionRoute = read("src/app/api/trade-job-readiness/route.ts");
const panel = read("src/components/TradeJobReadinessPanel.tsx");
const styles = read("src/app/globals.css");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

test("issued packet quotes store one immutable execution snapshot", () => {
  assert.match(schema, /sqliteTable\("trade_crm_quote_execution_snapshots"/);
  assert.match(migration, /CREATE TABLE `trade_crm_quote_execution_snapshots`/);
  for (const field of ["packets_json", "expected_duration_minutes", "suggested_crew_size", "required_capabilities_json"]) assert.match(migration, new RegExp(field));
  assert.match(quoteRoute, /buildQuoteExecutionSnapshot/);
  assert.match(quoteRoute, /INSERT INTO trade_crm_quote_execution_snapshots/);
  assert.match(snapshotServer, /task_titles/);
  assert.match(snapshotServer, /template_key, template_version/);
  assert.match(snapshotServer, /quotedRevision !== Number\(packet\.revision\)/);
});

test("accepted conversion reads the snapshot and keeps a manual quote fallback", () => {
  assert.match(executionRoute, /trade_crm_quote_execution_snapshots/);
  assert.match(executionRoute, /snapshot\?\.packets_json/);
  assert.match(executionRoute, /sourceKind = packets\.length \? "job_packet" : "manual_quote"/);
  assert.match(executionRoute, /packet\.taskTitles\.forEach/);
  assert.match(executionRoute, /packet\.forms\.forEach/);
  assert.match(executionRoute, /const manual = selected\.filter/);
});

test("actuals, variance and completion are authoritative and one-entry friendly", () => {
  assert.match(migration, /CREATE TABLE `trade_crm_job_actuals`/);
  assert.match(migration, /UNIQUE INDEX `trade_crm_job_actuals_requirement_idx`/);
  assert.match(executionRoute, /action === "actual"/);
  assert.match(executionRoute, /ON CONFLICT\(job_plan_requirement_id\) DO UPDATE/);
  assert.match(executionRoute, /varianceStatus/);
  assert.match(executionRoute, /action === "complete"/);
  assert.match(executionRoute, /Invoice and handover preparation are ready/);
  for (const copy of ["Used as planned", "Done as planned", "Actual differs", "Complete job and prepare invoice", "Finish cleanly without office re-entry"]) assert.match(panel, new RegExp(copy));
});

test("completion includes scope, forms, materials and requested proof", () => {
  assert.match(executionRoute, /photoRequestProofOverview/);
  assert.match(executionRoute, /completionChecks = \{ scope:/);
  assert.match(executionRoute, /forms: forms\.every\(requirementDone\)/);
  assert.match(executionRoute, /materials: materials\.every\(requirementDone\)/);
  assert.match(executionRoute, /proof: proof\.ready/);
  assert.match(panel, /No proof requested/);
  assert.match(panel, /Proof accepted/);
});

test("execution migration applies after the production dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql",
    "0019_melodic_unus.sql", "0020_lying_stick.sql", "0021_mushy_gamora.sql", "0022_worried_sleepwalker.sql", "0025_dizzy_spot.sql", "0047_customer_service_site_foundation.sql", "0050_versioned_trade_quotes.sql", "0057_customer_property_arrivals.sql", "0058_trade_contact_arrival_handoff.sql", "0064_trade_price_book.sql",
    "0065_trade_job_packets.sql", "0066_optioned_trade_quotes.sql", "0067_secure_quote_sharing.sql", "0068_accepted_quote_handoff.sql",
    "0069_ready_jobs_supplier_profiles.sql", "0070_frictionless_team_roster.sql", "0071_job_execution_progress.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_crm_job_actuals").get().count, 0);
  assert.ok(db.prepare("PRAGMA table_info(trade_crm_job_plans)").all().some((row) => row.name === "completed_at"));
});

test("job execution remains responsive and avoids prohibited dash characters", () => {
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*?\.crm-readiness-requirement \{[^}]*flex-direction: column/);
  assert.match(styles, /\.crm-actual-actions details > div \{[^}]*grid-template-columns: repeat\(2/);
  assert.doesNotMatch(`${quoteRoute}\n${snapshotServer}\n${executionRoute}\n${panel}`, /[\u2013\u2014]/);
});
