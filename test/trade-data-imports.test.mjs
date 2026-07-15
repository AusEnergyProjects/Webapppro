import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importTemplateCsv, parseImportCsv, validateImportCsv } from "../src/lib/trade-data-imports.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0034_pretty_masque.sql");
const route = read("../src/app/api/trade-imports/route.ts");
const importer = read("../src/components/TradeDataImportWorkspace.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const pilotRoute = read("../src/app/api/admin/usability-pilot/route.ts");
const pilotUi = read("../src/components/AdminUsabilityPilot.tsx");
const adminUi = read("../src/components/AdminOperationsPortal.tsx");

test("CSV parsing preserves quoted commas and escaped quotes", () => {
  const rows = parseImportCsv('first_name,private_notes\nAlex,"Quoted, with ""care"""\n');
  assert.deepEqual(rows, [["first_name", "private_notes"], ["Alex", 'Quoted, with "care"']]);
});

test("customer previews mark existing records as duplicates and default them to skip", () => {
  const csv = importTemplateCsv("customers");
  const result = validateImportCsv({ importType: "customers", source: csv, existingKeys: new Set(["email:alex.taylor@example.com"]), customerEmails: new Set() });
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.duplicate, 1);
  assert.equal(result.rows[0].status, "duplicate");
  assert.equal(result.rows[0].resolution, "skip");
  assert.equal(result.rows[1].status, "ready");
});

test("job previews warn when a customer link is unavailable but keep valid historical work importable", () => {
  const result = validateImportCsv({ importType: "jobs", source: importTemplateCsv("jobs"), existingKeys: new Set(), customerEmails: new Set() });
  assert.equal(result.summary.warning, 2);
  assert.equal(result.summary.error, 0);
  assert.ok(result.rows.every((row) => row.resolution === "import"));
  assert.match(result.rows[0].issues[0].message, /not in the CRM/);
});

test("product previews block duplicate model numbers from automatic import", () => {
  const result = validateImportCsv({ importType: "products", source: importTemplateCsv("products"), existingKeys: new Set(["model:ex-hp-270"]), customerEmails: new Set() });
  assert.equal(result.rows[0].status, "duplicate");
  assert.equal(result.rows[0].resolution, "skip");
  assert.equal(result.rows[1].status, "ready");
});

test("guided imports store durable previews, row decisions, results and rollback metadata", () => {
  assert.match(schema, /sqliteTable\("trade_data_import_batches"/);
  assert.match(schema, /sqliteTable\("trade_data_import_rows"/);
  assert.match(route, /validateImportCsv/);
  assert.match(route, /reserveTradeWorkNumbers\(db, identity\.uid, "JOB"/);
  assert.match(route, /target_entity_type = 'work_order'/);
  assert.match(route, /Record changed after import/);
  assert.match(route, /listing_status = 'archived'/);
  assert.match(importer, /Previewing makes no changes/);
  assert.match(importer, /Rollback unchanged records/);
});

test("installer and wholesaler dashboards expose the role-appropriate guided importer", () => {
  assert.match(crm, /TradeDataImportWorkspace user=\{user\} partnerType="installer"/);
  assert.match(dashboard, /TradeDataImportWorkspace user=\{user\} partnerType="supplier"/);
  assert.match(dashboard, /hasBusinessOperations && hasBulkImport/);
  assert.match(importer, /Imported products remain invisible to installers until approved/);
});

test("the field pilot has five live-business slots and excludes synthetic accounts", () => {
  assert.match(schema, /sqliteTable\("admin_usability_pilots"/);
  assert.match(schema, /sqliteTable\("admin_usability_pilot_participants"/);
  assert.match(schema, /sqliteTable\("admin_usability_pilot_sessions"/);
  assert.match(migration, /installer-crm-field-pilot-v1/);
  assert.match(migration, /5, 'recruiting'/);
  assert.match(pilotRoute, /COALESCE\(is_synthetic, 0\) = 0/);
  assert.match(pilotRoute, /taskCompletionRate/);
  assert.match(pilotRoute, /averageEase/);
  assert.match(pilotUi, /Five business slots/);
  assert.match(adminUi, /field-pilot/);
});

test("low pilot scores create proactive admin follow-up", () => {
  assert.match(pilotRoute, /easeScore <= 2 \|\| confidenceScore <= 2/);
  assert.match(pilotRoute, /pilot\.usability_friction/);
  assert.match(pilotRoute, /requiresAction: true/);
});

test("new migration and UI copy avoid prohibited dash characters", () => {
  assert.doesNotMatch(migration + route + importer + pilotRoute + pilotUi, /[\u2013\u2014]/);
});
