import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importTemplateCsv, mappedImportCsv, parseImportCsv, validateImportCsv } from "../src/lib/trade-data-imports.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0034_pretty_masque.sql");
const enquiryMigration = read("../drizzle/0048_unified_enquiry_inbox.sql");
const route = read("../src/app/api/trade-imports/route.ts");
const enquiryRoute = read("../src/app/api/trade-enquiries/route.ts");
const importer = read("../src/components/TradeDataImportWorkspace.tsx");
const enquiryInbox = read("../src/components/TradeEnquiryInbox.tsx");
const workbookReader = read("../src/lib/xlsx-import.ts");
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

test("enquiry previews preserve source IDs and require valid customer and service data", () => {
  const result = validateImportCsv({ importType: "enquiries", source: importTemplateCsv("enquiries"), existingKeys: new Set(["external:website:web-1042"]), customerEmails: new Set() });
  assert.equal(result.summary.total, 2);
  assert.equal(result.rows[0].status, "duplicate");
  assert.equal(result.rows[0].values.externalRecordId, "WEB-1042");
  assert.equal(result.rows[1].status, "ready");
});

test("column mapping creates canonical previews without mutating records", () => {
  const source = "Name,Email address,Scope\nTaylor,trade@example.com,Heat pump enquiry\n";
  const mapped = mappedImportCsv(source, "enquiries", { first_name: "Name", email: "Email address", description: "Scope" });
  const result = validateImportCsv({ importType: "enquiries", source: mapped, existingKeys: new Set(), customerEmails: new Set() });
  assert.equal(result.rows[0].values.firstName, "Taylor");
  assert.equal(result.rows[0].values.email, "trade@example.com");
});

test("unified inbox keeps protected marketplace records reference-only and requires explicit duplicate conversion", () => {
  assert.match(enquiryMigration, /protected_source.*duplicate_decision/s);
  assert.match(enquiryMigration, /JOIN `trade_opportunities`/);
  assert.doesNotMatch(enquiryMigration, /o\.postcode/);
  assert.match(enquiryRoute, /PROTECTED_CUSTOMER_BOUNDARY/);
  assert.match(enquiryRoute, /new Set\(\["create_new", "use_existing"\]\)/);
  assert.match(enquiryRoute, /trade_crm_customer_contacts/);
  assert.match(enquiryRoute, /trade_crm_service_sites/);
  assert.match(enquiryInbox, /Duplicate review/);
  assert.match(enquiryInbox, /Privacy boundary active/);
});

test("CSV and Excel imports share mapping, preview, issue export and rollback", () => {
  assert.match(importer, /workbookToCsv/);
  assert.match(importer, /mappedImportCsv/);
  assert.match(importer, /Export issues/);
  assert.match(workbookReader, /unzipSync/);
  assert.match(route, /target_entity_type = 'crm_enquiry'/);
  assert.match(route, /type === "crm_enquiry"/);
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
  assert.doesNotMatch(migration + enquiryMigration + route + enquiryRoute + importer + enquiryInbox + pilotRoute + pilotUi, /[\u2013\u2014]/);
});
