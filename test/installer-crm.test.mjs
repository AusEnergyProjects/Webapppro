import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL } from "../src/lib/trade-crm-job-index-sql.ts";
import {
  INSTALLER_CUSTOMER_REGISTER_SORT_VALUES,
  INSTALLER_JOB_REGISTER_SORT_VALUES,
} from "../src/lib/trade-crm-register-sorts.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0019_melodic_unus.sql");
const customerCreatedIndexMigration = read("../drizzle/0167_trade_customer_created_index.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const customerSortSql = read("../src/lib/trade-crm-register-sort-sql.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const home = read("../src/components/TradeHomeDashboard.tsx");
const newJob = read("../src/components/TradeNewJobForm.tsx");
const recoverableWorkspace = read("../src/components/RecoverableTradeWorkspace.tsx");
const hub = read("../src/components/TradeBusinessHub.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const numberer = read("../src/lib/trade-job-number-server.ts");
const dataforceCsv = read("../src/lib/creditex-dataforce-job-csv.ts");
const listViews = read("../src/lib/workspace-list-views.ts");
const addressSuggestionsRoute = read("../src/app/api/trade-address-suggestions/route.ts");

test("installer CRM customers, job details, appointments and notes are durable and indexed", () => {
  assert.match(schema, /sqliteTable\("trade_crm_customers"/);
  assert.match(schema, /sqliteTable\("trade_crm_job_details"/);
  assert.match(schema, /sqliteTable\("trade_crm_appointments"/);
  assert.match(schema, /sqliteTable\("trade_crm_job_notes"/);
  assert.match(schema, /trade_crm_customers_owner_status_idx/);
  assert.match(schema, /trade_crm_customers_owner_created_idx/);
  assert.match(schema, /trade_crm_job_details_owner_pipeline_idx/);
  assert.match(schema, /trade_crm_appointments_owner_start_idx/);
  assert.match(schema, /trade_crm_job_notes_work_order_idx/);
});

test("the CRM migration applies cleanly to SQLite", () => {
  const db = new DatabaseSync(":memory:");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) db.exec(statement);
  db.exec(customerCreatedIndexMigration);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_appointments", "trade_crm_customers", "trade_crm_job_details", "trade_crm_job_notes"]);
  const customerIndexes = db.prepare("PRAGMA index_list(trade_crm_customers)").all().map((row) => row.name);
  assert.ok(customerIndexes.includes("trade_crm_customers_owner_created_idx"));
  db.close();
});

test("CRM access is same-origin, verified-team gated and owner scoped", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireInstallerTeamAccess/);
  assert.match(route, /type TeamAccess/);
  assert.match(route, /TradeAccessError/);
  assert.match(route, /uid: access\.ownerUid/);
  assert.match(route, /memberId: access\.memberId/);
  assert.match(route, /identity\.access\.jobScope/);
  assert.doesNotMatch(route, /billing_status/);
  assert.match(route, /WHERE firebase_uid = \?/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /TEAM_ACCESS_REQUIRED/);
  assert.match(route, /MEMBER_ACTIVE_JOB_LIMIT = 500/);
  assert.match(route, /CRM_CUSTOMER_LIMIT = 5000/);
});

test("platform households stay separate from installer-owned contacts", () => {
  assert.match(route, /sourceType === "opportunity" \? "platform_private"/);
  assert.match(route, /const protectedCustomer = customerSource === "platform_private";/);
  assert.match(route, /crmCustomerId: protectedCustomer \? ""/);
  assert.match(route, /platformPrivate \? ""/);
  assert.match(crm, /Australian Energy Assessments manages the household relationship/);
  assert.match(crm, /project scope, broad service region and protected reference/);
  assert.match(crm, /Only add contacts who came directly to your business/);
  assert.match(crm, /Australian Energy Assessments protected households never appear here/);
});

test("direct customers have full addresses while global TLink job IDs are read only", () => {
  assert.match(crm, /name="addressLine1"/);
  assert.match(crm, /name="addressLine2"/);
  assert.match(newJob, /Assigned automatically/);
  assert.match(newJob, /One private global reference is shown to your team, the assigned compliance team and TLink support/);
  assert.doesNotMatch(newJob, /name="(?:workNumber|jobId)"/);
  assert.doesNotMatch(crm, /name="customerReference"/);
  assert.match(route, /nextTlinkJobNumber/);
  assert.match(numberer, /ON CONFLICT\(firebase_uid, counter_key\) DO UPDATE/);
  assert.match(numberer, /last_value = last_value \+ 1/);
  assert.doesNotMatch(route, /organisationName:\s*String\(snapshot\.organisation/);
  assert.doesNotMatch(crm, /item\.organisationName/);
  assert.match(numberer, /return `TLJ-\$\{TLINK_OPAQUE_JOB_MARKER\}\$\{code\}`/);
  assert.match(numberer, /formatTlinkJobNumber\(value\)/);
});

test("verified installers receive the complete progressive CRM", () => {
  assert.match(hub, /props\.partnerType === "installer" && props\.fullAccess/);
  assert.match(hub, /BusinessHubFoundation/);
  for (const label of ["Home dashboard", "Jobs", "Schedule", "Customers", "Reports", "Files", "Quote", "Invoice", "Notes", "Handover"]) {
    assert.match(crm, new RegExp(label));
  }
  assert.match(crm, /NewJobForm/);
  assert.match(crm, /CustomerForm/);
  assert.match(crm, /TradeHandoverCentre/);
  assert.match(home, /outstandingCents/);
  assert.match(crm, /min=\{minimumStart\}/);
  assert.match(route, /assertFutureAppointment/);
  assert.match(route, /PAST_APPOINTMENT/);
});

test("large installer job and customer directories use server paging, sorting and lazy detail", () => {
  assert.match(route, /mode === "index"/);
  assert.match(route, /mode === "detail"/);
  assert.match(route, /PAGE_SIZES = new Set\(\[25, 50, 100\]\)/);
  assert.match(route, /decodeKeysetCursor/);
  assert.match(route, /keysetAfter/);
  assert.doesNotMatch(route, /LIMIT \? OFFSET \?/);
  assert.match(route, /SELECT COUNT\(\*\) total/);
  assert.match(route, /"number-asc"/);
  assert.match(customerSortSql, /"name-desc"/);
  assert.match(route, /Object\.hasOwn\(JOB_SORTS, sortValue\)/);
  assert.match(route, /Object\.hasOwn\(CUSTOMER_REGISTER_SORTS, sortValue\)/);
  assert.doesNotMatch(route, /schedule_empty,\s*\$\{joins\}/, "the job index SELECT must not leave a trailing comma before FROM");
  assert.match(crm, /mode: "index", resource: "jobs"/);
  assert.match(crm, /mode: "index", resource: "customers"/);
  assert.match(crm, /mode=detail&resource=job/);
  assert.match(crm, /mode=detail&resource=customer/);
  assert.match(crm, /SortableIndexHeading/);
});

test("the installer job index selects the scheduled appointment with D1-compatible SQL", () => {
  assert.match(route, /d\.crm_customer_id, d\.service_site_id, d\.customer_source, d\.pipeline_stage, d\.building_type/);
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE trade_work_orders (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      scheduled_start text NOT NULL
    );
    CREATE TABLE trade_crm_appointments (
      id text PRIMARY KEY NOT NULL,
      work_order_id text NOT NULL,
      firebase_uid text NOT NULL,
      status text NOT NULL,
      starts_at text NOT NULL,
      created_at text NOT NULL
    );
    INSERT INTO trade_work_orders VALUES ('job-1', 'installer-1', '2026-08-04T10:00:00.000Z');
    INSERT INTO trade_work_orders VALUES ('job-2', 'installer-1', '2026-08-06T10:00:00.000Z');
    INSERT INTO trade_work_orders VALUES ('job-3', 'installer-1', '2026-08-07T10:00:00.000Z');
    INSERT INTO trade_crm_appointments VALUES
      ('job-1-old', 'job-1', 'installer-1', 'scheduled', '2026-08-03T10:00:00.000Z', '2026-08-01T00:00:00.000Z'),
      ('job-1-current', 'job-1', 'installer-1', 'scheduled', '2026-08-04T10:00:00.000Z', '2026-08-02T00:00:00.000Z'),
      ('job-2-cancelled', 'job-2', 'installer-1', 'cancelled', '2026-08-05T10:00:00.000Z', '2026-08-01T00:00:00.000Z'),
      ('job-2-fallback', 'job-2', 'installer-1', 'scheduled', '2026-08-08T10:00:00.000Z', '2026-08-02T00:00:00.000Z');
  `);
  const rows = db.prepare(`
    SELECT w.id, selected_appointment.id appointment_id, selected_appointment.starts_at appointment_starts_at
    FROM trade_work_orders w
    ${TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL}
    ORDER BY w.id
  `).all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "job-1", appointment_id: "job-1-current", appointment_starts_at: "2026-08-04T10:00:00.000Z" },
    { id: "job-2", appointment_id: "job-2-fallback", appointment_starts_at: "2026-08-08T10:00:00.000Z" },
    { id: "job-3", appointment_id: null, appointment_starts_at: null },
  ]);
  assert.doesNotMatch(TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL, /ORDER BY[^;]*w\.scheduled_start/s);
});

test("installer jobs export every filtered page through the owner scoped Dataforce projection", () => {
  assert.match(crm, /DATAFORCE_JOB_EXPORT_PAGE_SIZE = 100/);
  assert.match(crm, /DATAFORCE_JOB_EXPORT_MAX_ROWS = 5000/);
  assert.match(crm, /const downloadAllFilteredJobs = useCallback\(async \(\) =>/);
  assert.match(crm, /jobIndexParams\(page, DATAFORCE_JOB_EXPORT_PAGE_SIZE, cursor, page === 1\)/);
  assert.match(crm, /headers: \{ Authorization: `Bearer \$\{token\}` \}/);
  assert.match(crm, /while \(true\)/);
  assert.match(crm, /seenCursors\.has\(nextCursor\)/);
  assert.match(crm, /seenJobIds\.has\(item\.id\)/);
  assert.match(crm, /records\.length !== expectedTotal/);
  assert.match(crm, /DATAFORCE_JOB_CSV_HEADERS\.some\(\(header\) => typeof record\[header\] !== "string"\)/);
  assert.match(crm, /exportDataforceJobCsv\(records\)/);
  assert.match(crm, /tlink-creditex-job-register\.csv/);
  assert.match(crm, /exportLabel="Download all filtered jobs CSV"/);
  assert.match(crm, /exportBusyLabel="Downloading all filtered jobs CSV\.\.\."/);
  assert.doesNotMatch(crm, /indexedJobs\.map\(\(job\) => job\.dataforceRecord\)/);
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /customer: canViewCustomer \? \{/);
  assert.match(route, /serviceSite: canViewCustomer \? \{/);
});

test("the job register uses separate operational columns without changing the Dataforce export contract", () => {
  const registerImport = crm.match(/import\s*\{([^}]+)\}\s*from\s*"@\/lib\/trade-crm-job-register"/);
  assert.ok(registerImport, "the register consumes the shared column contract");
  const imports = registerImport[1].split(",").map(value => value.trim());
  assert.ok(imports.includes("JOB_REGISTER_COLUMN_KEYS"));
  assert.ok(imports.includes("type JobRegisterRecord"));
  assert.match(crm, /JOB_REGISTER_DEFAULT_COLUMNS/);
  assert.match(crm, /function safeJobRegisterColumns\(columns: unknown\): JobRegisterColumnKey\[\]/);
  assert.match(crm, /!JOB_REGISTER_COLUMN_KEY_SET\.has\(key\)/);
  assert.match(crm, /new Set\(columns\)\.size !== columns\.length/);
  assert.match(crm, /return \[\.\.\.columns\] as JobRegisterColumnKey\[\]/);
  assert.match(crm, /setJobColumns\(safeJobRegisterColumns\(preferences\.jobColumnOrderVersion === 5 \? preferences\.columns : undefined\)\)/);
  assert.match(crm, /jobColumnOrderVersion: 5, columns: jobColumns/);
  assert.match(crm, /setJobColumns\(safeJobRegisterColumns\(preferences\.columns\)\)/);
  assert.doesNotMatch(crm, /setJobColumns\(preferences\.columns\?\./);
  for (const label of ["Job ID", "First name", "Last name", "Contact number", "Email", "Street address", "Postcode", "Suburb", "State", "Assigned worker", "Schedule date", "Created date", "Quote total ex GST", "STC", "VEEC", "ESC", "Other certs"]) {
    assert.match(crm, new RegExp(`label: "${label}"`));
  }
  const headerBlock = dataforceCsv.match(/DATAFORCE_JOB_CSV_HEADERS = Object\.freeze\(\[([\s\S]*?)\] as const\)/);
  assert.ok(headerBlock);
  const headers = Array.from(headerBlock[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
  assert.deepEqual(headers, [
    "App Id", "Job Id", "Status", "SubStatus", "Type", "Work Type", "Scheduled Datetime", "Balance",
    "Certificates (VEECs)", "Submission", "Invoiced", "Field Worker", "Agent", "Client", "Customer",
    "Company Name", "Ext Cust Ref", "Phone", "Mobile", "Email", "Address", "Suburb", "Postcode",
  ]);
});

test("the New Job requires direct contact details and projects Mobile rather than Phone", () => {
  assert.match(newJob, /<span>Mobile<\/span><input type="tel" name="phone" required=\{step === 2\}/);
  assert.match(newJob, /<span>Email<\/span><input type="email" name="email" required=\{step === 2\}/);
  assert.match(route, /phone: "",\s+mobile: String\(row\.customer_phone \|\| ""\)/);
});

test("the New Job handoff carries a bounded ordered set of planned government activities", () => {
  assert.match(newJob, /MAX_PLANNED_COMPLIANCE_ACTIVITIES = 12/);
  assert.match(newJob, /const complianceActivitiesJson = JSON\.stringify\(plannedActivities\)/);
  assert.match(newJob, /name="complianceActivitiesJson" value=\{complianceActivitiesJson\}/);
  assert.match(newJob, /const legacyComplianceActivity = plannedActivities\[0\]/);
  assert.match(newJob, /name="programTemplateId" value=\{legacyComplianceActivity\?\.programTemplateId \|\| ""\}/);
  assert.match(newJob, /name="activityTemplateId" value=\{legacyComplianceActivity\?\.activityTemplateId \|\| ""\}/);
});

test("saved preferences and job or customer reads cancel stale requests before they can replace current state", () => {
  assert.match(crm, /loadJobIndex = useCallback\(async \(signal: AbortSignal\)/);
  assert.match(crm, /loadCustomerIndex = useCallback\(async \(signal: AbortSignal\)/);
  assert.equal((crm.match(/const controller = new AbortController\(\);/g) || []).length, 5);
  assert.equal((crm.match(/signal\.aborted\) return;/g) || []).length, 2);
  assert.equal((crm.match(/controller\.abort\(\); if \(timer\) window\.clearTimeout\(timer\)/g) || []).length, 2);
  assert.match(crm, /loadJobIndex\(controller\.signal\)/);
  assert.match(crm, /loadCustomerIndex\(controller\.signal\)/);
  assert.equal((crm.match(/signal: controller\.signal/g) || []).length, 3);
  assert.equal((crm.match(/active && !controller\.signal\.aborted/g) || []).length, 3);
  assert.equal((crm.match(/return \(\) => \{ active = false; controller\.abort\(\); \};/g) || []).length, 2);
  assert.match(crm, /loadedRef\.current = true;\s+applied = true;/);
  assert.match(crm, /return \(\) => \{ active = false; controller\.abort\(\); if \(!applied\) loadedRef\.current = false; \};/);
});

test("job and customer directories expose granular server filters and single-line data columns", () => {
  for (const field of ["customer", "service", "pipeline", "stage", "assignee", "location", "firstName", "lastName", "businessName", "email", "street", "phone", "postcode", "suburb", "state", "jobId"]) {
    assert.match(route, new RegExp(`searchParams\\.get\\("${field}"\\)`));
  }
  assert.match(route, /GROUP_CONCAT\(DISTINCT service_category\)/);
  assert.match(route, /latest_job_number/);
  assert.match(route, /latest_pipeline_stage/);
  assert.match(crm, /Detailed job filters/);
  assert.match(crm, /Detailed customer filters/);
  assert.match(crm, /<span>First name<\/span>/);
  assert.match(crm, /<span>Last name<\/span>/);
  assert.match(crm, /<span>Business<\/span>/);
  assert.match(crm, /<span>Email<\/span>/);
  assert.match(crm, /<span>Assigned worker<\/span>/);
  assert.match(crm, /Street address/);
  assert.match(crm, /Contact number/);
  assert.match(crm, /Completion status/);
  assert.match(crm, /jobIndexColumns/);
  assert.match(crm, /customerIndexColumns/);
  assert.match(crm, /crm-record-data-row/);
  assert.match(crm, /jobColumns\.map/);
  assert.match(crm, /customerColumns\.map/);
  for (const column of ["Customer", "First name", "Last name", "Email", "Phone", "Suburb", "Postcode", "Jobs", "Created date", "Latest job", "Status"]) {
    assert.match(crm, new RegExp(`label: "${column}"`));
  }
  assert.match(crm, /<span>Last name<\/span><input value=\{jobLastName\}/);
  assert.match(crm, /<span>Last name<\/span><input value=\{customerLastName\}/);
  assert.match(crm, /changeCustomerRegisterSort/);
  assert.match(crm, /aria-sort=\{direction === "asc" \? "ascending" : direction === "desc" \? "descending" : "none"\}/);
  const customerColumnsBlock = crm.match(/const customerIndexColumns = \[([\s\S]*?)\n\] as const satisfies readonly SortableIndexColumn/);
  assert.ok(customerColumnsBlock);
  for (const line of customerColumnsBlock[1].split("\n").filter((line) => line.includes("{ key:"))) {
    assert.match(line, /sort: \["[^"]+", "[^"]+"\]/);
  }
  const jobColumnsBlock = crm.match(/const jobIndexColumns = \[([\s\S]*?)\n\] as const satisfies readonly JobIndexColumn\[\]/);
  assert.ok(jobColumnsBlock);
  const jobColumnLines = jobColumnsBlock[1].split("\n").filter((line) => line.includes("{ key:"));
  const unsorted = ["actions", "customerBilling", "invoicePayment"];
  assert.equal(jobColumnLines.filter((line) => line.includes("sort: null")).length, unsorted.length);
  for (const key of unsorted) assert.match(jobColumnLines.find((line) => line.includes(`key: "${key}"`)), /sort: null/);
  for (const line of jobColumnLines.filter((line) => !unsorted.some(key => line.includes(`key: "${key}"`)))) {
    assert.match(line, /sort: \["[^"]+", "[^"]+"\]/);
  }
  assert.match(crm, /export type JobIndexColumnCoverage = AssertNever<Exclude<JobRegisterColumnKey, typeof jobIndexColumns\[number\]\["key"\]>>/);
});

test("job filters preserve existing saved fields and add authoritative register filters", () => {
  for (const field of ["appointmentId", "scheduledFrom", "scheduledTo", "createdFrom", "createdTo", "invoiceStatus", "customerReference"]) {
    assert.match(crm, new RegExp(`${field}:`));
    assert.match(crm, new RegExp(`preferences\\.${field}`));
    assert.match(listViews, new RegExp(`raw\\.${field}`));
  }
  for (const field of ["jobId", "email", "phone", "suburb", "postcode"]) {
    assert.match(crm, new RegExp(`${field}`));
  }
  assert.match(crm, /data-date-range-group="installer-job-scheduled"/);
  assert.match(crm, /data-date-range-group="installer-job-created"/);
  assert.match(crm, /data-date-range-group="installer-customer-created"/);
  assert.match(crm, /params\.set\("scheduledFromUtc", localDateBoundary\(jobScheduledFrom\)\)/);
  assert.match(crm, /params\.set\("scheduledToUtc", localDateBoundary\(jobScheduledTo, true\)\)/);
  assert.match(crm, /params\.set\("createdFromUtc", localDateBoundary\(customerCreatedFrom\)\)/);
  assert.match(crm, /data-date-range-role="start"/);
  assert.match(crm, /data-date-range-role="end"/);
  for (const field of ["firstName", "lastName", "street", "state", "operationalStatus", "quoteTotalMin", "quoteTotalMax"]) {
    assert.match(route, new RegExp(`searchParams\\.get\\("${field}"\\)`));
  }
  assert.match(crm, /Quote total ex GST from/);
  assert.match(crm, /Quote total ex GST to/);
});

test("job and customer indexes use explicit open and direct contact actions", () => {
  assert.match(crm, /className="crm-index-open-button"/);
  assert.match(crm, /className="crm-index-phone-link" href=\{phoneHref/);
  assert.match(crm, /return compact \? `tel:\$\{compact\}` : ""/);
  assert.match(crm, /TradeCustomerEmailComposer user=\{user\} customerId=\{customer\.id\} recipient=\{customer\.email\} recipientName=\{customer\.displayName\} className="crm-index-email-link"/);
  const customerResultsStart = crm.indexOf('aria-label="Customer results"');
  assert.notEqual(customerResultsStart, -1);
  const customerResults = crm.slice(customerResultsStart, crm.indexOf("</section></div>", customerResultsStart));
  assert.match(customerResults, /className=\{`\$\{registerStyles\.row\} crm-record-data-row crm-index-row`\}/);
  assert.match(customerResults, /style=\{customerRecordStyle\}/);
  assert.doesNotMatch(customerResults, /crm-row-open/);
  assert.doesNotMatch(crm, /<button[^>]*className="crm-row-open crm-record-data-row"/);
  assert.match(crm, /onContextMenu=\{\(event\) => openCustomerActions\(event, customer\.id\)\}/);
  assert.match(crm, /button:not\(\.crm-index-open-button\)/);
  assert.match(crm, /event\.key === "F10" && event\.shiftKey/);
  assert.match(crm, /<button autoFocus role="menuitem" type="button" onClick=\{openCustomer\}>View details<\/button>/);
  assert.match(crm, />New job for customer<\/button>/);
});

test("the customer index aggregates owned job facts once without crossing the privacy boundary", () => {
  assert.match(route, /WITH matching_customers AS \(/);
  assert.match(route, /SELECT c\.\* FROM trade_crm_customers c WHERE \$\{where\}/);
  assert.match(route, /owned_jobs AS \(/);
  assert.match(route, /ROW_NUMBER\(\) OVER \(PARTITION BY d\.crm_customer_id ORDER BY w\.updated_at DESC, w\.id DESC\) latest_rank/);
  assert.match(route, /customer_job_summary AS \(/);
  assert.match(route, /LEFT JOIN customer_job_summary js ON js\.crm_customer_id = c\.id/);
  assert.match(route, /candidate_customers AS \(/);
  assert.match(route, /JOIN candidate_customers matched ON matched\.id = d\.crm_customer_id AND matched\.firebase_uid = d\.firebase_uid/);
  assert.match(route, /WHERE d\.firebase_uid = \? AND w\.record_status = 'active'/);
  assert.match(route, /const sortNeedsJobSummary = CUSTOMER_JOB_DERIVED_SORTS\.has/);
  assert.match(route, /sortNeedsJobSummary[\s\S]*\[\.\.\.bindings, identity\.uid, \.\.\.\(cursorFilter\?\.bindings \|\| \[\]\), pageSize \+ 1\][\s\S]*\[\.\.\.bindings, \.\.\.\(cursorFilter\?\.bindings \|\| \[\]\), pageSize \+ 1, identity\.uid\]/);
  assert.match(route, /\.bind\(\.\.\.rowBindings\)/);
});

test("every trusted register sort has a server mapping and saved-view allowlist", () => {
  for (const value of INSTALLER_JOB_REGISTER_SORT_VALUES) assert.match(route, new RegExp(`"${value}"\\s*:`));
  for (const value of INSTALLER_CUSTOMER_REGISTER_SORT_VALUES) assert.match(customerSortSql, new RegExp(`"${value}"\\s*:`));
  assert.match(route, /satisfies Record<InstallerJobRegisterSort, CrmSort>/);
  assert.match(customerSortSql, /satisfies Record<InstallerCustomerRegisterSort, CrmSort>/);
  assert.match(customerSortSql, /CUSTOMER_PIPELINE_STATUS_LABEL_SQL/);
  assert.match(customerSortSql, /customer_status_sort/);
  assert.match(listViews, /"installer-jobs": new Set\(INSTALLER_JOB_REGISTER_SORT_VALUES\)/);
  assert.match(listViews, /"installer-customers": new Set\(INSTALLER_CUSTOMER_REGISTER_SORT_VALUES\)/);
});

test("job and customer directories open focused records without automatic or inline detail", () => {
  assert.doesNotMatch(crm, /items\[0\]\?\.id/);
  assert.doesNotMatch(crm, /\bsetSelectedJobId\(/);
  assert.match(crm, /onClick=\{\(\) => openFocusedJob\(job\.id\)\}/);
  assert.match(crm, /crm-view crm-job-workspace/);
  assert.match(crm, /crm-view crm-customer-focus/);
  assert.match(crm, /mapWorkspace \? "Back to map" : "Back to all jobs"/);
  assert.match(crm, /mapWorkspace \? "Back to map" : "Back to all customers"/);
  assert.match(crm, /jobReturnTarget\.kind === "customer"/);
  assert.match(crm, /kind: "customer", customerId: selectedCustomerDetail\.id, customerName: selectedCustomerDetail\.displayName/);

  const jobDirectoryStart = crm.indexOf('{!mapWorkspace && view === "jobs" && creating !== "job" && !focusedJobId');
  const jobDirectoryEnd = crm.indexOf('{view === "schedule"', jobDirectoryStart);
  assert.ok(jobDirectoryStart >= 0 && jobDirectoryEnd > jobDirectoryStart);
  assert.doesNotMatch(crm.slice(jobDirectoryStart, jobDirectoryEnd), /<JobDetail/);

  const customerDirectoryStart = crm.indexOf('{!mapWorkspace && view === "customers" && creating !== "customer" && !selectedCustomerId');
  const customerDirectoryEnd = crm.indexOf('{view === "templates"', customerDirectoryStart);
  assert.ok(customerDirectoryStart >= 0 && customerDirectoryEnd > customerDirectoryStart);
  assert.doesNotMatch(crm.slice(customerDirectoryStart, customerDirectoryEnd), /<CustomerDetail/);
});

test("owner and staff CRM destinations follow the primary navigation and saved access", () => {
  assert.match(crm, /if \(!staffPermissions\) return \["today", "leads", "jobs", "schedule", "customers", "pricebook", "assets", "templates", "reports", "import", "integrations"\]/);
  assert.doesNotMatch(crm, /TradeEnquiryInbox|"enquiries" as View/);
  assert.match(crm, /navigationTarget\?\.kind === "crm-view"[\s\S]*allowedViews\.some\(\(item\) => item === navigationTarget\.id\)[\s\S]*appliedNavigationTargetNonce\.current !== navigationTarget\.nonce[\s\S]*view !== navigationTarget\.id[\s\S]*\) return;[\s\S]*onViewChange\?\.\(view\)/);
  assert.match(crm, /appliedNavigationTargetNonce\.current = navigationTarget\.nonce;[\s\S]*setView\(navigationTarget\.id\)/);
  assert.match(dashboard, /setCommandTarget\(\(current\) => workspace === "map"\s*\? \{ workspace: "work", kind: "crm-view", id: nextView, query: "", nonce: Date\.now\(\) \}\s*: current\?\.kind === "crm-view" && current\.id !== nextView \? null : current\)/);
  assert.match(crm, /if \(staffPermissions\.canViewCustomers && staffPermissions\.canSearchCustomers\) views\.push\("customers"\)/);
  assert.match(crm, /if \(staffPermissions\.canViewPriceBook\) views\.push\("pricebook"\)/);
  assert.match(crm, /if \(staffPermissions\.canRunReports\) views\.push\("reports"\)/);
  assert.doesNotMatch(crm, /TradeTeamCentre|"team" as View/);
  assert.match(dashboard, /workspace === "team"/);
  assert.match(dashboard, /People, access and member records/);
  assert.doesNotMatch(crm, /crm-more-nav/);
  assert.match(crm, /item === "import" \? "Import data"/);
  assert.match(crm, /if \(item === "jobs"\) \{ setFocusedJobId\(""\); setJobReturnTarget\(\{ kind: "jobs" \}\); \}/);
  assert.match(crm, /if \(item === "customers"\) \{ setSelectedCustomerIdState\(""\); setSelectedCustomerDetail\(null\); \}/);
});

test("customer detail exposes prominent contact actions and dates every linked job", () => {
  assert.match(crm, /className="crm-customer-contact-actions"/);
  assert.match(crm, /className="crm-customer-call-action" href=\{phoneHref\(customer\.phone\)\}/);
  assert.match(crm, /TradeCustomerEmailComposer user=\{user\} customerId=\{customer\.id\} recipient=\{customer\.email\} recipientName=\{customer\.displayName\} label="Email customer" className="crm-customer-email-action"/);
  assert.match(crm, /job\.scheduledStart \? `Scheduled \$\{dateLabel\(job\.scheduledStart\)\}` : `Created \$\{dateLabel\(job\.createdAt\)\}`/);
});

test("bulk CRM actions are bounded, owner scoped and protect active customer work", () => {
  assert.match(route, /function cleanIds/);
  assert.match(route, /slice\(0, 100\)/);
  assert.match(route, /action === "bulk_set_job_priority"/);
  assert.match(route, /action === "bulk_archive_customers"/);
  assert.match(route, /firebase_uid = \? AND partner_type = 'installer'/);
  assert.match(route, /Customers with active jobs cannot be archived/);
  assert.match(route, /jobSyncChangeStatements/);
  assert.doesNotMatch(crm, /selectedJobIds|crm-row-select[\s\S]*Select \$\{job\.workNumber\}/);
  assert.match(crm, /ids: selectedCustomerIds/);
  assert.match(crm, /Only customers with no active jobs can be archived/);
});

test("installer dashboard and reports use compact server-owned read models", () => {
  for (const mode of ["bootstrap", "summary", "home", "reports"]) {
    assert.match(route, new RegExp(`mode === "${mode}"`));
  }
  assert.match(route, /async function crmBootstrap/);
  assert.match(route, /async function crmSummary/);
  assert.match(route, /async function crmReports/);
  assert.match(route, /SUM\(CASE WHEN stage NOT IN/);
  assert.match(route, /loadBusinessReport\(getD1\(\), identity\.uid/);
  assert.match(crm, /trade-crm\?mode=bootstrap/);
  assert.match(home, /trade-crm\?mode=home/);
  assert.match(crm, /<TradeBusinessReports user=\{user\}/);
  assert.match(read("../src/components/TradeBusinessReports.tsx"), /trade-crm\?mode=reports/);
  for (const legacyState of ["CrmScheduleResult", "scheduleItems", "schedulePage", "schedulePagination", "scheduleCursors", 'mode: "schedule"']) {
    assert.doesNotMatch(crm, new RegExp(legacyState));
  }
});

test("all installer Schedule entry paths use the one permanent CRM dispatch workspace", () => {
  assert.match(crm, /const TradeScheduleWorkspace = recoverableTradeWorkspace\(\(\) => import\("\.\/TradeScheduleWorkspace"\)/);
  assert.match(crm, /if \(item === "schedule"\) \{ openVisualSchedule\(\); return; \}/);
  assert.match(crm, /onOpenSchedule=\{openVisualSchedule\}/);
  assert.match(crm, /view === "schedule"[\s\S]*?<TradeScheduleWorkspace user=\{user\} permissions=\{staffPermissions\} initialWeekStart=\{scheduleWeekStart\}/);
  assert.match(crm, /onOpenQuote=\{\(!staffPermissions \|\| staffPermissions\.canViewQuotes\) \? \(id\) => openFocusedJob\(id, "quote"\) : undefined\}/);
  assert.match(hub, /onOpenSchedule=\{props\.onOpenSchedule\}/);
  assert.match(hub, /onViewChange=\{props\.onWorkViewChange\}/);
  assert.doesNotMatch(dashboard, /<TradeScheduleWorkspace/);
  assert.doesNotMatch(dashboard, /workspace === "schedule"/);
  assert.match(dashboard, /onOpenSchedule=\{\(weekStart\) => \{[\s\S]*id: "schedule"[\s\S]*query: weekStart \|\| ""[\s\S]*setWorkspace\("work"\)/);
});

test("job Files renders every planned compliance activity without exposing raw governance copy", () => {
  assert.match(crm, /complianceIntents: ComplianceIntent\[\]/);
  assert.match(crm, /const complianceIntents = job\.complianceIntents\?\.length \? job\.complianceIntents : job\.complianceIntent \? \[job\.complianceIntent\] : \[\]/);
  assert.match(crm, /formsOpen && complianceIntents\.length > 0 && <TradeActivityFieldRecords/);
  const fieldRecords = fs.readFileSync(new URL("../src/components/TradeActivityFieldRecords.tsx", import.meta.url), "utf8");
  assert.match(fieldRecords, /records\.map\(\(item\) => <article key=\{item\.intentId\}>/);
  assert.match(crm, /const canOpenDirectCustomerCompliance = !permissions\s+&& canManageFieldEvidence\s+&& job\.sourceType === "internal"\s+&& job\.customerSource === "trade_owned"/);
  assert.match(crm, /canOpenDirectCustomerCompliance && unlinkedComplianceIntents\.length > 0 && <details[\s\S]*?Optional compliance case setup[\s\S]*?unlinkedComplianceIntents\.map/);
  assert.match(crm, /\{canOpenDirectCustomerCompliance && customer && complianceIntents\.length === 0 && complianceCases\.length === 0 && <TradeComplianceIntake/);
  assert.doesNotMatch(crm, /!isProtected && customer && complianceIntents\.length === 0 && complianceCases\.length === 0 && <TradeComplianceIntake/);
  assert.match(crm, /initialIntent=\{intent\}/);
  assert.doesNotMatch(crm, /\{(?:job\.complianceIntent|intent)\.governanceMessage\}/);
  assert.match(fieldRecords, /Creditex receives the completed record for review and handles certificate creation/);
});

test("staff checklist controls use the hardened scoped CRM task actions", () => {
  const binStart = crm.indexOf("  async function changeJobBin(");
  const binEnd = crm.indexOf("  function openCustomerActions(", binStart);
  assert.ok(binStart >= 0 && binEnd > binStart, "the owner-only bin handler has a distinct boundary");
  const binHandler = crm.slice(binStart, binEnd);
  assert.match(binHandler, /if \(staffPermissions \|\|[^\n]+\) return;/);
  assert.match(binHandler, /fetch\('\/api\/trade-work-orders'/);
  assert.match(binHandler, /action: restore \? 'restore_crm_job' : 'archive_crm_job'/);
  assert.match(binHandler, /workOrderId: job\.id, expectedRevision: job\.revision/);
  assert.doesNotMatch(crm.slice(0, binStart) + crm.slice(binEnd), /\/api\/trade-work-orders/);
  assert.match(crm, /onWorkOrder=\{crmRequest\}/);
  assert.match(route, /const manageActions = new Set\(\["create_note", "add_task"\]\)/);
  assert.match(route, /const assignedJobActions = new Set\(\["resend_activity_customer_documents"\]\)/);
  assert.match(route, /if \(!identity\.access\.isOwner && actionJobId && \(manageActions\.has\(action\) \|\| assignedJobActions\.has\(action\)\)\) \{\s*await assignedJob\(identity\.access, actionJobId\)/);
  assert.match(route, /if \(action === "add_task"\)/);
  assert.match(route, /if \(action === "update_task"\)/);
  assert.match(route, /if \(!identity\.access\.isOwner\) await assignedJob\(identity\.access, String\(task\.work_order_id\)\)/);
});

test("job bin confirmation stays inside TLink and supports cancellation and focus recovery", () => {
  assert.doesNotMatch(crm, /window\.confirm/);
  assert.match(crm, /if \(archived\) void changeJobBin\(job, true\); else \{ setBinError\(""\); setBinJob\(job\); \}/);
  assert.match(crm, /dialog && !dialog\.open\) dialog\.showModal\(\);\s*binCancelRef\.current\?\.focus\(\)/);
  assert.match(crm, /<dialog ref=\{binDialogRef\}[^>]+aria-labelledby=\{binDialogTitleId\}[^>]+aria-describedby=\{binDialogDescriptionId\}[^>]+onCancel=\{event => \{ event\.preventDefault\(\); closeJobBin\(\); \}\}/);
  assert.match(crm, /<small>\{binJob\.workNumber\}<\/small>/);
  assert.match(crm, /Its customer, original import and history will be kept\. You can restore this job from the Deleted status filter\./);
  assert.match(crm, /function closeJobBin\(\) \{\s*if \(binPendingRef\.current\) return;/);
  assert.match(crm, /\(trigger \|\| crmHeadingRef\.current\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(crm, /ref=\{crmHeadingRef\} tabIndex=\{-1\}/);
  assert.match(crm, /ref=\{binCancelRef\} type="button" disabled=\{busy === `bin:\$\{binJob\.id\}`\}/);
  assert.match(crm, /<button type="submit" disabled=\{busy === `bin:\$\{binJob\.id\}`\}/);
  assert.match(crm, /\{binError && <p role="alert">\{binError\}<\/p>\}/);
});

test("job bin requests require an owner and confirmed job, prevent duplicates and preserve the loaded revision", async () => {
  const start = crm.indexOf("  async function changeJobBin(");
  const end = crm.indexOf("  function openCustomerActions(", start);
  assert.ok(start >= 0 && end > start);
  const script = ts.transpileModule(crm.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const job = { id: "job-a", revision: 8 };
  const requests = [], errors = [], statuses = [];
  let closed = 0, refreshed = 0, failRequest = false, releaseToken;
  let indexedJobs = [job, { id: "job-b", revision: 3 }], page = 3;
  const scope = {
    staffPermissions: undefined, binJob: job, binPendingRef: { current: false },
    jobCursors: { current: ["", "old-cursor-2", "old-cursor-3"] }, jobTotalReady: { current: true },
    setBinError: value => errors.push(value), setBusy() {}, setStatus: value => statuses.push(value),
    setIndexedJobs: update => { indexedJobs = update(indexedJobs); }, setJobPage: value => { page = value; },
    user: { getIdToken: () => new Promise(resolve => { releaseToken = resolve; }) },
    fetch: async (url, options) => { requests.push({ url, ...options }); return { ok: !failRequest, json: async () => failRequest ? { error: "This job changed. Refresh and try again." } : { ok: true } }; },
    setRefreshNonce() { refreshed += 1; }, load: async () => { throw new Error("Unrelated bootstrap unavailable"); }, closeJobBin() { closed += 1; },
  };
  const handler = overrides => {
    const dependencies = { ...scope, ...overrides };
    return new Function(...Object.keys(dependencies), `${script}\nreturn changeJobBin;`)(...Object.values(dependencies));
  };
  await handler({ staffPermissions: {} })(job, false);
  await handler({ binJob: null })(job, false);
  assert.equal(requests.length, 0);
  const changeJobBin = handler({});
  const pending = changeJobBin(job, false);
  assert.equal(scope.binPendingRef.current, true);
  await changeJobBin(job, false);
  releaseToken("test-token");
  await pending;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/trade-work-orders");
  assert.deepEqual(JSON.parse(requests[0].body), { action: "archive_crm_job", workOrderId: "job-a", expectedRevision: 8 });
  assert.equal(closed, 1); assert.equal(refreshed, 1); assert.equal(scope.binPendingRef.current, false);
  assert.deepEqual(indexedJobs.map(item => item.id), ["job-b"], "the confirmed job disappears before the asynchronous list refresh");
  assert.equal(page, 1); assert.deepEqual(scope.jobCursors.current, [""]);
  assert.equal(scope.jobTotalReady.current, false, "the next list fetch must recount the filtered jobs");
  assert.equal(statuses.at(-1), "Job moved to the bin. Restore it from the Deleted status filter.", "unrelated bootstrap failure must not disguise a confirmed mutation");
  indexedJobs = [job]; page = 2; scope.jobTotalReady.current = true; scope.jobCursors.current = ["", "retry-cursor"];
  failRequest = true;
  const retry = changeJobBin(job, false);
  releaseToken("test-token"); await retry;
  assert.equal(closed, 1, "a rejected request leaves the confirmation visible");
  assert.equal(errors.at(-1), "This job changed. Refresh and try again.");
  assert.equal(scope.binPendingRef.current, false);
  assert.deepEqual(indexedJobs, [job], "a rejected mutation keeps the row");
  assert.equal(page, 2); assert.equal(scope.jobTotalReady.current, true); assert.deepEqual(scope.jobCursors.current, ["", "retry-cursor"]);
  assert.equal(refreshed, 1);
  failRequest = false;
  const restore = handler({ binJob: null })(job, true);
  releaseToken("test-token"); await restore;
  assert.deepEqual(JSON.parse(requests.at(-1).body), { action: "restore_crm_job", workOrderId: "job-a", expectedRevision: 8 });
  assert.equal(closed, 1, "restore does not open or close an archive confirmation");
  assert.deepEqual(indexedJobs, [], "a restored job immediately leaves the Deleted list");
  assert.equal(page, 1); assert.deepEqual(scope.jobCursors.current, [""]); assert.equal(scope.jobTotalReady.current, false);
  assert.equal(refreshed, 2); assert.equal(statuses.at(-1), "Job restored.");
});

test("reviewed installer team members use the same authenticated address suggestions", () => {
  assert.match(newJob, /endpoint="\/api\/trade-address-suggestions"/);
  assert.match(newJob, /getAuthorization=\{getAuthorization\}/);
  assert.match(addressSuggestionsRoute, /requireInstallerTeamAccess\(request\)/);
  assert.doesNotMatch(addressSuggestionsRoute, /canCreateJobs|ADDRESS_ACCESS_REQUIRED/);
});

test("heavy workspaces load dynamically and profile readiness does not wait for opportunities", () => {
  for (const workspace of ["SupplierCatalogueWorkspace", "TradePurchasingWorkspace", "TradeDataImportWorkspace", "TradeFinanceWorkspace"]) {
    assert.match(dashboard, new RegExp(`const ${workspace} = dynamic\\(\\(\\) => import\\("\\./${workspace}"\\)`));
    assert.doesNotMatch(dashboard, new RegExp(`import \\{ ${workspace} \\} from "\\./${workspace}"`));
  }
  for (const workspace of ["TradeIntegrationCentre", "TradeFieldWorkPanel", "TradePriceBookWorkspace", "TradeQuickInvoicePanel"]) {
    assert.match(crm, new RegExp(`const ${workspace} = dynamic\\(\\(\\) => import\\("\\./${workspace}"\\)`));
  }

  const profileLoadStart = dashboard.indexOf("async function loadDashboard()");
  const profileLoadEnd = dashboard.indexOf("}, [fetch, user]);", profileLoadStart);
  assert.ok(profileLoadStart >= 0 && profileLoadEnd > profileLoadStart);
  const profileLoad = dashboard.slice(profileLoadStart, profileLoadEnd);
  assert.match(profileLoad, /fetch\("\/api\/trade-profile"/);
  assert.match(profileLoad, /setProfile\(nextProfile\)/);
  assert.match(profileLoad, /setLoading\(false\)/);
  assert.doesNotMatch(profileLoad, /trade-opportunities/);
  assert.match(dashboard.slice(profileLoadEnd), /if \(!user \|\| !profile[\s\S]*?fetch\("\/api\/trade-opportunities"/);
});

test("new job and schedule loaders recover instead of leaving stale chunks blank", () => {
  assert.match(crm, /import type \{ TradeNewJobInitial \} from "\.\/TradeNewJobForm";/);
  assert.match(crm, /const TradeNewJobForm = recoverableTradeWorkspace\(\(\) => import\("\.\/TradeNewJobForm"\)/);
  assert.match(crm, /const TradeNewJobForm = recoverableTradeWorkspace\(\(\) => import\("\.\/TradeNewJobForm"\)\.then\(\(module\) => module\.TradeNewJobForm\)\);/);
  assert.match(crm, /<TradeNewJobForm key=/);
  assert.match(newJob, /module\.TradeScheduleWorkspace\), false\);/);
  assert.match(recoverableWorkspace, /const key = "tlinkRetry"/);
  assert.match(recoverableWorkspace, /if \(!sessionStorage\.getItem\(key\)\)/);
  assert.match(recoverableWorkspace, /location\.reload\(\)/);
  assert.match(recoverableWorkspace, /return function TradeWorkspaceLoadFailure/);
  assert.match(crm, /if \(creating !== "job"\) return;[\s\S]*?newJobHeadingRef\.current\?\.scrollIntoView\(\{ block: "start" \}\);[\s\S]*?newJobHeadingRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(crm, /<h3 ref=\{newJobHeadingRef\} tabIndex=\{-1\}>Create job<\/h3>/);
});

test("Home dashboard preserves direct work and finance navigation", () => {
  assert.match(route, /australiaLocalDateTime\(identity\.addressState\)\.slice\(0, 10\)/);
  assert.match(route, /Array\.from\(\{ length: 4 \}/);
  assert.match(route, /weekEnd: addSummaryDays\(weekStart, 6\)/);
  assert.match(route, /a\.status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\)/);
  assert.match(route, /NOT EXISTS \(SELECT 1 FROM trade_crm_appointments/);
  assert.match(route, /w\.stage NOT IN \('imported', 'completed', 'cancelled'\) GROUP BY w\.stage/);
  assert.match(route, /if \(!Number\.isFinite\(start\) \|\| !Number\.isFinite\(end\) \|\| end <= start\) return 60/);
  assert.match(route, /Math\.max\(15, Math\.min\(480/);
  assert.match(route, /todayVisits:/);
  assert.match(route, /awaitingSchedule:/);
  assert.match(route, /workStages:/);
  assert.match(crm, /<TradeHomeDashboard user=\{user\} staffPermissions=\{staffPermissions\}/);
  assert.match(crm, /onOpenJob=\{openFocusedJob\} onOpenSchedule=\{openVisualSchedule\}/);
  assert.match(crm, /onNewJob=\{canCreateJob/);
  assert.match(crm, /onOpenInvoices=\{\(!staffPermissions \|\| staffPermissions.canViewInvoices\)/);
  assert.doesNotMatch(crm, /CrmSummaryResult|crm-dashboard-insights|My day/);
  assert.match(crm, /onOpenFinance\("pricebook", next\)/);
  assert.match(crm, /initialView=\{priceBookView\}/);
  assert.match(crm, /key=\{priceBookView\}/);
  assert.match(hub, /onOpenSchedule=\{props\.onOpenSchedule\}/);
  assert.match(hub, /onViewChange=\{props\.onWorkViewChange\}/);
  assert.match(hub, /onOpenInvoices=\{props\.onOpenInvoices\}/);
  assert.match(crm, /const \[scheduleWeekStart, setScheduleWeekStart\] = useState\(""\)/);
  assert.match(crm, /initialWeekStart=\{scheduleWeekStart\}/);
  assert.match(dashboard, /onWorkViewChange=\{\(nextView\) => \{\s*if \(workspace === "map" && \(nextView === "jobs" \|\| nextView === "customers"\)\) return;\s*if \(nextView === "pricebook" \|\| nextView === "reports"\) \{ openFinance\(nextView\); return; \}\s*setWorkspace\("work", \(\) => \{\s*setCommandTarget\(\(current\) => workspace === "map"\s*\? \{ workspace: "work", kind: "crm-view", id: nextView, query: "", nonce: Date\.now\(\) \}\s*: current\?\.kind === "crm-view" && current\.id !== nextView \? null : current\);\s*setActiveWorkView\(nextView\);\s*\}\);\s*\}\}/);
  assert.match(dashboard, /onOpenInvoices=\{\(\) => openFinance\("invoices"\)\}/);
});

test("CRM writes no longer return the full customer and job workspace", () => {
  assert.equal((route.match(/crmPayload\(identity\)/g) || []).length, 0);
  assert.match(route, /return adminJson\(\{ ok: true, id: workOrderId, workNumber, customerId, serviceSiteId,\s*appointmentId, complianceIntentPlanned: complianceIntents\.length > 0,\s*complianceIntentCount: complianceIntents\.length,\s*complianceWorkPacks,\s*workPackReady,\s*workPackBlockers,\s*rentalInspectionAttached: Boolean\(rentalTemplate\),\s*rentalInspectionModuleCount: rentalModuleKeys\.length,\s*calendarSynced, calendarFailed, calendarInvite, customerDocuments, quickQuote \}, 201\)/);
  assert.match(crm, /type CreateJobResult = \{[\s\S]*complianceIntentPlanned\?: boolean; complianceIntentCount\?: number; workPackReady\?: boolean;[\s\S]*workPackBlockers\?: Array<\{ code: string; message: string \}>;[\s\S]*rentalInspectionAttached\?: boolean; rentalInspectionModuleCount\?: number;[\s\S]*calendarSynced\?: number; calendarFailed\?: number;/);
  assert.match(newJob, /The assigned compliance team can review the customer, site, activity and schedule/);
  assert.match(newJob, /regulated case opens only when the exact published rule, product, evidence policy and calculation pathway are ready/);
  assert.match(route, /return adminJson\(\{ ok: true, id, customerNumber \}, 201\)/);
  assert.match(crm, /CustomerLookupSelect/);
  assert.match(crm, /Name, number, phone, suburb or postcode/);
  assert.match(crm, /pageSize: "25"/);
});
