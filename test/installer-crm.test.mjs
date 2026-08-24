import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TRADE_CRM_CURRENT_APPOINTMENT_JOIN_SQL } from "../src/lib/trade-crm-job-index-sql.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0019_melodic_unus.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const newJob = read("../src/components/TradeNewJobForm.tsx");
const hub = read("../src/components/TradeBusinessHub.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const customerLifecycle = read("../src/components/CustomerAssetLifecycle.tsx");
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
  assert.match(schema, /trade_crm_job_details_owner_pipeline_idx/);
  assert.match(schema, /trade_crm_appointments_owner_start_idx/);
  assert.match(schema, /trade_crm_job_notes_work_order_idx/);
});

test("the CRM migration applies cleanly to SQLite", () => {
  const db = new DatabaseSync(":memory:");
  const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_appointments", "trade_crm_customers", "trade_crm_job_details", "trade_crm_job_notes"]);
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
  for (const label of ["My day", "Jobs", "Schedule", "Customers", "Reports", "Field work", "Quote", "Invoice", "Notes", "Handover"]) {
    assert.match(crm, new RegExp(label));
  }
  assert.match(crm, /NewJobForm/);
  assert.match(crm, /CustomerForm/);
  assert.match(crm, /TradeHandoverCentre/);
  assert.match(crm, /outstandingCents/);
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
  assert.match(route, /"name-desc"/);
  assert.doesNotMatch(route, /schedule_empty,\s*\$\{joins\}/, "the job index SELECT must not leave a trailing comma before FROM");
  assert.match(crm, /mode: "index", resource: "jobs"/);
  assert.match(crm, /mode: "index", resource: "customers"/);
  assert.match(crm, /mode=detail&resource=job/);
  assert.match(crm, /mode=detail&resource=customer/);
  assert.match(crm, /Recently updated/);
  assert.match(crm, /Name A to Z/);
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
  assert.match(crm, /tlink-dataforce-compatible-jobs\.csv/);
  assert.match(crm, /exportLabel="Download all filtered jobs CSV"/);
  assert.match(crm, /exportBusyLabel="Downloading all filtered jobs CSV\.\.\."/);
  assert.doesNotMatch(crm, /indexedJobs\.map\(\(job\) => job\.dataforceRecord\)/);
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /customer: canViewCustomer \? \{/);
  assert.match(route, /serviceSite: canViewCustomer \? \{/);
});

test("the job register uses separate operational columns without changing the Dataforce export contract", () => {
  assert.match(crm, /import \{ JOB_REGISTER_COLUMN_KEYS, type JobRegisterRecord \}/);
  assert.match(crm, /JOB_REGISTER_DEFAULT_COLUMNS/);
  assert.match(crm, /function safeJobRegisterColumns\(columns: unknown\): JobRegisterColumnKey\[\]/);
  assert.match(crm, /!JOB_REGISTER_COLUMN_KEY_SET\.has\(key\)/);
  assert.match(crm, /new Set\(columns\)\.size !== columns\.length/);
  assert.match(crm, /return \[\.\.\.columns\] as JobRegisterColumnKey\[\]/);
  assert.match(crm, /setJobColumns\(safeJobRegisterColumns\(preferences\.jobColumnOrderVersion === 3 \? preferences\.columns : undefined\)\)/);
  assert.match(crm, /setJobColumns\(safeJobRegisterColumns\(preferences\.columns\)\)/);
  assert.doesNotMatch(crm, /setJobColumns\(preferences\.columns\?\./);
  for (const label of ["Job ID", "First name", "Last name", "Contact number", "Email", "Street address", "Postcode", "Suburb", "State", "Assigned worker", "Schedule date", "Quote total ex GST", "STC", "VEEC", "ESC", "Other certs"]) {
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
  for (const column of ["Customer", "First name", "Last name", "Email", "Phone", "Suburb", "Postcode", "Jobs", "Latest job", "Status"]) {
    assert.match(crm, new RegExp(`label: "${column}"`));
  }
});

test("job filters preserve existing saved fields and add authoritative register filters", () => {
  for (const field of ["appointmentId", "scheduledFrom", "scheduledTo", "invoiceStatus", "customerReference"]) {
    assert.match(crm, new RegExp(`${field}:`));
    assert.match(crm, new RegExp(`preferences\\.${field}`));
    assert.match(listViews, new RegExp(`raw\\.${field}`));
  }
  for (const field of ["jobId", "email", "phone", "suburb", "postcode"]) {
    assert.match(crm, new RegExp(`${field}`));
  }
  assert.match(crm, /data-date-range-group="installer-job-scheduled"/);
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
  assert.match(crm, /className="crm-index-email-link" href=\{`mailto:\$\{customer\.email\}`\}/);
  assert.match(crm, /className="crm-record-data-row crm-index-row"/);
  assert.doesNotMatch(crm, /<button[^>]*className="crm-row-open crm-record-data-row"/);
});

test("the customer index aggregates owned job facts once without crossing the privacy boundary", () => {
  assert.match(route, /WITH owned_jobs AS \(/);
  assert.match(route, /ROW_NUMBER\(\) OVER \(PARTITION BY d\.crm_customer_id ORDER BY w\.updated_at DESC, w\.id DESC\) latest_rank/);
  assert.match(route, /customer_job_summary AS \(/);
  assert.match(route, /LEFT JOIN customer_job_summary js ON js\.crm_customer_id = c\.id/);
  assert.match(route, /WHERE d\.firebase_uid = \? AND w\.record_status = 'active'/);
  assert.match(route, /\.bind\(identity\.uid, \.\.\.rowBindings, pageSize \+ 1\)/);
});

test("job and customer directories open focused records without automatic or inline detail", () => {
  assert.doesNotMatch(crm, /items\[0\]\?\.id/);
  assert.doesNotMatch(crm, /\bsetSelectedJobId\(/);
  assert.match(crm, /onClick=\{\(\) => openFocusedJob\(job\.id\)\}/);
  assert.match(crm, /crm-view crm-job-workspace/);
  assert.match(crm, /crm-view crm-customer-focus/);
  assert.match(crm, /Back to all jobs/);
  assert.match(crm, /Back to all customers/);
  assert.match(crm, /jobReturnTarget\.kind === "customer"/);
  assert.match(crm, /kind: "customer", customerId: selectedCustomerDetail\.id, customerName: selectedCustomerDetail\.displayName/);

  const jobDirectoryStart = crm.indexOf('{view === "jobs" && creating !== "job" && !focusedJobId');
  const jobDirectoryEnd = crm.indexOf('{view === "schedule"', jobDirectoryStart);
  assert.ok(jobDirectoryStart >= 0 && jobDirectoryEnd > jobDirectoryStart);
  assert.doesNotMatch(crm.slice(jobDirectoryStart, jobDirectoryEnd), /<JobDetail/);

  const customerDirectoryStart = crm.indexOf('{view === "customers" && creating !== "customer" && !selectedCustomerId');
  const customerDirectoryEnd = crm.indexOf('{view === "templates"', customerDirectoryStart);
  assert.ok(customerDirectoryStart >= 0 && customerDirectoryEnd > customerDirectoryStart);
  assert.doesNotMatch(crm.slice(customerDirectoryStart, customerDirectoryEnd), /<CustomerDetail/);
});

test("owner and staff CRM destinations follow the primary navigation and saved access", () => {
  assert.match(crm, /if \(!staffPermissions\) return \["today", "enquiries", "jobs", "schedule", "customers", "pricebook", "assets", "templates", "reports", "import", "integrations"\]/);
  assert.match(crm, /if \(staffPermissions\.canViewCustomers && staffPermissions\.canSearchCustomers\) views\.push\("customers"\)/);
  assert.match(crm, /if \(staffPermissions\.canViewPriceBook\) views\.push\("pricebook"\)/);
  assert.match(crm, /if \(staffPermissions\.canRunReports\) views\.push\("reports"\)/);
  assert.doesNotMatch(crm, /TradeTeamCentre|"team" as View/);
  assert.match(dashboard, /workspace === "team"/);
  assert.match(dashboard, /People, access and member records/);
  assert.doesNotMatch(crm, /crm-more-nav/);
  assert.match(crm, /item === "import" \? "Import data"/);
  assert.match(crm, /if \(item === "jobs"\) \{ setFocusedJobId\(""\); setJobReturnTarget\(\{ kind: "jobs" \}\); \}/);
  assert.match(crm, /if \(item === "customers"\) \{ setSelectedCustomerId\(""\); setSelectedCustomerDetail\(null\); \}/);
});

test("customer detail exposes prominent contact actions and dates every linked job", () => {
  assert.match(crm, /className="crm-customer-contact-actions"/);
  assert.match(crm, /className="crm-customer-call-action" href=\{phoneHref\(customer\.phone\)\}/);
  assert.match(crm, /className="crm-customer-email-action" href=\{`mailto:\$\{customer\.email\}`\}/);
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
  for (const mode of ["bootstrap", "summary", "reports"]) {
    assert.match(route, new RegExp(`mode === "${mode}"`));
  }
  assert.match(route, /async function crmBootstrap/);
  assert.match(route, /async function crmSummary/);
  assert.match(route, /async function crmReports/);
  assert.match(route, /SUM\(CASE WHEN stage NOT IN/);
  assert.match(route, /GROUP BY COALESCE\(d\.pipeline_stage/);
  assert.match(crm, /trade-crm\?mode=bootstrap/);
  assert.match(crm, /trade-crm\?mode=summary/);
  assert.match(crm, /trade-crm\?mode=reports/);
  for (const legacyState of ["CrmScheduleResult", "scheduleItems", "schedulePage", "schedulePagination", "scheduleCursors", 'mode: "schedule"']) {
    assert.doesNotMatch(crm, new RegExp(legacyState));
  }
});

test("all installer Schedule entry paths use the one permanent CRM dispatch workspace", () => {
  assert.match(crm, /const TradeScheduleWorkspace = dynamic\(\(\) => import\("\.\/TradeScheduleWorkspace"\)/);
  assert.match(crm, /if \(item === "schedule"\) \{ openVisualSchedule\(\); return; \}/);
  assert.match(crm, /onClick=\{\(\) => openVisualSchedule\(\)\} aria-label=\{`Open today's \$\{metrics\.todayVisits\} scheduled visits`\}/);
  assert.match(crm, /view === "schedule"[\s\S]*?<TradeScheduleWorkspace user=\{user\} permissions=\{staffPermissions\} initialWeekStart=\{scheduleWeekStart\}/);
  assert.match(crm, /onOpenQuote=\{\(!staffPermissions \|\| staffPermissions\.canViewQuotes\) \? \(id\) => openFocusedJob\(id, "quote"\) : undefined\}/);
  assert.match(hub, /onOpenSchedule=\{props\.onOpenSchedule\}/);
  assert.match(hub, /onViewChange=\{props\.onWorkViewChange\}/);
  assert.doesNotMatch(dashboard, /<TradeScheduleWorkspace/);
  assert.doesNotMatch(dashboard, /workspace === "schedule"/);
  assert.match(dashboard, /onOpenSchedule=\{\(weekStart\) => \{[\s\S]*id: "schedule"[\s\S]*query: weekStart \|\| ""[\s\S]*setWorkspace\("work"\)/);
});

test("job summary renders every planned compliance activity without exposing raw governance copy", () => {
  assert.match(crm, /complianceIntents: ComplianceIntent\[\]/);
  assert.match(crm, /const complianceIntents = job\.complianceIntents\?\.length \? job\.complianceIntents : job\.complianceIntent \? \[job\.complianceIntent\] : \[\]/);
  assert.match(crm, /complianceIntents\.map\(\(intent\) => <section className="crm-job-compliance" key=\{intent\.id\}>/);
  assert.match(crm, /\{!permissions && canManageFieldEvidence && unlinkedComplianceIntents\.map\(\(intent\) => <TradeComplianceIntake key=\{intent\.id\}/);
  assert.doesNotMatch(crm, /!isProtected && customer && unlinkedComplianceIntents\.map/);
  assert.match(crm, /initialIntent=\{intent\}/);
  assert.doesNotMatch(crm, /\{(?:job\.complianceIntent|intent)\.governanceMessage\}/);
  assert.match(crm, /Confirm the governed activity, product, scenario and evidence requirements before work starts/);
});

test("staff checklist controls use the hardened scoped CRM task actions", () => {
  assert.doesNotMatch(crm, /\/api\/trade-work-orders/);
  assert.match(crm, /onWorkOrder=\{crmRequest\}/);
  assert.match(route, /const manageActions = new Set\(\["create_note", "add_task"\]\)/);
  assert.match(route, /if \(!identity\.access\.isOwner && actionJobId && manageActions\.has\(action\)\) \{\s*await assignedJob\(identity\.access, actionJobId\)/);
  assert.match(route, /if \(action === "add_task"\)/);
  assert.match(route, /if \(action === "update_task"\)/);
  assert.match(route, /if \(!identity\.access\.isOwner\) await assignedJob\(identity\.access, String\(task\.work_order_id\)\)/);
});

test("staff who can create jobs can use the same authenticated address suggestions", () => {
  assert.match(newJob, /\/api\/trade-address-suggestions\?query=/);
  assert.match(addressSuggestionsRoute, /requireInstallerTeamAccess\(request\)/);
  assert.match(addressSuggestionsRoute, /if \(!canCreateJobs\(access\)\) throw new Error\("ADDRESS_ACCESS_REQUIRED"\)/);
});

test("heavy workspaces load dynamically and profile readiness does not wait for opportunities", () => {
  for (const workspace of ["SupplierCatalogueWorkspace", "TradePurchasingWorkspace", "TradeDataImportWorkspace", "TradeInvoiceWorkspace", "TradeServiceFollowUpWorkspace"]) {
    assert.match(dashboard, new RegExp(`const ${workspace} = dynamic\\(\\(\\) => import\\("\\./${workspace}"\\)`));
    assert.doesNotMatch(dashboard, new RegExp(`import \\{ ${workspace} \\} from "\\./${workspace}"`));
  }
  for (const workspace of ["TradeIntegrationCentre", "TradeFieldWorkPanel", "TradePriceBookWorkspace", "TradeNewJobForm", "TradeQuickInvoicePanel", "TradeScheduleWorkspace"]) {
    assert.match(crm, new RegExp(`const ${workspace} = dynamic\\(\\(\\) => import\\("\\./${workspace}"\\)`));
  }

  const profileLoadStart = dashboard.indexOf("async function loadDashboard()");
  const profileLoadEnd = dashboard.indexOf("}, [user]);", profileLoadStart);
  assert.ok(profileLoadStart >= 0 && profileLoadEnd > profileLoadStart);
  const profileLoad = dashboard.slice(profileLoadStart, profileLoadEnd);
  assert.match(profileLoad, /fetch\("\/api\/trade-profile"/);
  assert.match(profileLoad, /setProfile\(nextProfile\)/);
  assert.match(profileLoad, /setLoading\(false\)/);
  assert.doesNotMatch(profileLoad, /trade-opportunities/);
  assert.match(dashboard.slice(profileLoadEnd), /if \(!user \|\| !profile[\s\S]*?fetch\("\/api\/trade-opportunities"/);
});

test("My day exposes owner scoped local workload and direct action charts", () => {
  assert.match(route, /australiaLocalDateTime\(identity\.addressState\)\.slice\(0, 10\)/);
  assert.match(route, /Array\.from\(\{ length: 4 \}/);
  assert.match(route, /weekEnd: addSummaryDays\(weekStart, 6\)/);
  assert.match(route, /a\.status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\)/);
  assert.match(route, /NOT EXISTS \(SELECT 1 FROM trade_crm_appointments/);
  assert.match(route, /w\.stage NOT IN \('completed', 'cancelled'\) GROUP BY w\.stage/);
  assert.match(route, /if \(!Number\.isFinite\(start\) \|\| !Number\.isFinite\(end\) \|\| end <= start\) return 60/);
  assert.match(route, /Math\.max\(15, Math\.min\(480/);
  assert.match(route, /todayVisits:/);
  assert.match(route, /awaitingSchedule:/);
  assert.match(route, /workStages:/);
  for (const label of ["Today visits", "Awaiting schedule", "Overdue tasks", "Waiting jobs", "Booked work", "Work status", "New job", "Common jobs", "Invoices"]) {
    assert.match(crm, new RegExp(label));
  }
  assert.match(crm, /className="crm-dashboard-chart crm-workload-chart"/);
  assert.match(crm, /className="crm-dashboard-chart crm-work-status-chart"/);
  assert.match(crm, /className="crm-chart-row"/);
  assert.match(crm, /aria-label=\{`Open schedule for/);
  assert.match(crm, /openJobsForStage\(item\.stage\)/);
  assert.match(crm, /setPriceBookView\("packets"\); setView\("pricebook"\)/);
  assert.match(crm, /initialView=\{priceBookView\}/);
  assert.match(crm, /key=\{priceBookView\}/);
  assert.match(hub, /onOpenSchedule=\{props\.onOpenSchedule\}/);
  assert.match(hub, /onViewChange=\{props\.onWorkViewChange\}/);
  assert.match(hub, /onOpenInvoices=\{props\.onOpenInvoices\}/);
  assert.match(crm, /const \[scheduleWeekStart, setScheduleWeekStart\] = useState\(""\)/);
  assert.match(crm, /initialWeekStart=\{scheduleWeekStart\}/);
  assert.match(dashboard, /onWorkViewChange=\{setActiveWorkView\}/);
  assert.match(dashboard, /onOpenInvoices=\{\(\) => setWorkspace\("invoices"\)\}/);
});

test("CRM writes no longer return the full customer and job workspace", () => {
  assert.equal((route.match(/crmPayload\(identity\)/g) || []).length, 0);
  assert.match(route, /return adminJson\(\{ ok: true, id: workOrderId, workNumber, customerId, serviceSiteId,\s*appointmentId, complianceIntentPlanned: complianceIntents\.length > 0,\s*complianceIntentCount: complianceIntents\.length,\s*rentalInspectionAttached: Boolean\(rentalTemplate\),\s*rentalInspectionModuleCount: rentalModuleKeys\.length,\s*calendarSynced, calendarFailed \}, 201\)/);
  assert.match(crm, /type CreateJobResult = \{ ok\?: boolean; id\?: string; workNumber\?: string; customerId\?: string; serviceSiteId\?: string; complianceIntentPlanned\?: boolean; complianceIntentCount\?: number; rentalInspectionAttached\?: boolean; rentalInspectionModuleCount\?: number; calendarSynced\?: number; calendarFailed\?: number;/);
  assert.match(newJob, /The assigned compliance team can review the customer, site, activity and schedule/);
  assert.match(newJob, /regulated case opens only when the exact published rule, product, evidence policy and calculation pathway are ready/);
  assert.match(route, /return adminJson\(\{ ok: true, id, customerNumber \}, 201\)/);
  assert.match(crm, /CustomerLookupSelect/);
  assert.match(crm, /Name, number, phone, suburb or postcode/);
  assert.match(crm, /pageSize: "25"/);
});

test("new CRM and customer copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${crm}\n${customerLifecycle}`, /[\u2013\u2014]/);
});
