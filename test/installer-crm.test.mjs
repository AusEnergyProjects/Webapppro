import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0019_melodic_unus.sql");
const route = read("../src/app/api/trade-crm/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const newJob = read("../src/components/TradeNewJobForm.tsx");
const hub = read("../src/components/TradeBusinessHub.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const customerAssets = read("../src/components/CustomerAssetOwnershipCentre.tsx");
const customerLifecycle = read("../src/components/CustomerAssetLifecycle.tsx");
const numberer = read("../src/lib/trade-job-number-server.ts");

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

test("CRM access is same-origin, installer-only, active, verification-gated and owner scoped", () => {
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /requireFirebaseIdentity/);
  assert.match(route, /account\.partner_type !== "installer"/);
  assert.match(route, /account\.account_status !== "active"/);
  assert.match(route, /entitlements\.features\.business_operations/);
  assert.match(route, /WHERE firebase_uid = \?/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(route, /w\.firebase_uid = \?/);
  assert.match(route, /TEAM_ACCESS_REQUIRED/);
  assert.match(route, /MEMBER_ACTIVE_JOB_LIMIT = 500/);
  assert.match(route, /CRM_CUSTOMER_LIMIT = 5000/);
});

test("platform households stay separate from installer-owned contacts", () => {
  assert.match(route, /sourceType === "opportunity" \? "platform_private"/);
  assert.match(route, /customerSource === "platform_private" \? ""/);
  assert.match(route, /platformPrivate \? ""/);
  assert.match(crm, /AEA manages the household relationship/);
  assert.match(crm, /project scope, broad service region and protected reference/);
  assert.match(crm, /Only add contacts who came directly to your business/);
  assert.match(crm, /AEA protected households never appear here/);
});

test("direct customers have full addresses while global TLink job IDs are read only", () => {
  assert.match(crm, /name="addressLine1"/);
  assert.match(crm, /name="addressLine2"/);
  assert.match(newJob, /Assigned automatically/);
  assert.match(crm, /This same ID is used by your team and TLink support/);
  assert.doesNotMatch(crm, /name="customerReference"/);
  assert.match(route, /nextTlinkJobNumber/);
  assert.match(numberer, /ON CONFLICT\(firebase_uid, counter_key\) DO UPDATE/);
  assert.match(numberer, /last_value = last_value \+ 1/);
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
  assert.match(crm, /<span>Installer<\/span>/);
  assert.match(crm, /Street address/);
  assert.match(crm, /Contact number/);
  assert.match(crm, /Completion status/);
  assert.match(crm, /crm-job-columns/);
  assert.match(crm, /crm-customer-columns/);
  for (const column of ["Customer", "First name", "Last name", "Email", "Phone", "Suburb", "Postcode", "Jobs", "Latest job", "Status"]) {
    assert.match(crm, new RegExp(`<span>${column}<\\/span>`));
  }
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
  assert.match(crm, /crm-view crm-job-focus/);
  assert.match(crm, /crm-view crm-customer-focus/);
  assert.match(crm, /Back to jobs/);
  assert.match(crm, /Back to customers/);

  const jobDirectoryStart = crm.indexOf('{view === "jobs" && creating !== "job" && !focusedJobId');
  const jobDirectoryEnd = crm.indexOf('{view === "schedule"', jobDirectoryStart);
  assert.ok(jobDirectoryStart >= 0 && jobDirectoryEnd > jobDirectoryStart);
  assert.doesNotMatch(crm.slice(jobDirectoryStart, jobDirectoryEnd), /<JobDetail/);

  const customerDirectoryStart = crm.indexOf('{view === "customers" && creating !== "customer" && !selectedCustomerId');
  const customerDirectoryEnd = crm.indexOf('{view === "templates"', customerDirectoryStart);
  assert.ok(customerDirectoryStart >= 0 && customerDirectoryEnd > customerDirectoryStart);
  assert.doesNotMatch(crm.slice(customerDirectoryStart, customerDirectoryEnd), /<CustomerDetail/);
});

test("all installer CRM destinations are visible in the primary navigation", () => {
  assert.match(crm, /\["today", "enquiries", "jobs", "schedule", "customers", "pricebook", "assets", "templates", "reports", "import", "integrations"/);
  assert.match(crm, /\.\.\.\(hasTeamAccess \? \["team" as View\] : \[\]\)/);
  assert.doesNotMatch(crm, /crm-more-nav/);
  assert.match(crm, /item === "import" \? "Import data"/);
  assert.match(crm, /if \(item === "jobs"\) setFocusedJobId\(""\)/);
  assert.match(crm, /if \(item === "customers"\) \{ setSelectedCustomerId\(""\); setSelectedCustomerDetail\(null\); \}/);
});

test("bulk CRM actions are bounded, owner scoped and protect active customer work", () => {
  assert.match(route, /function cleanIds/);
  assert.match(route, /slice\(0, 100\)/);
  assert.match(route, /action === "bulk_set_job_priority"/);
  assert.match(route, /action === "bulk_archive_customers"/);
  assert.match(route, /firebase_uid = \? AND partner_type = 'installer'/);
  assert.match(route, /Customers with active jobs cannot be archived/);
  assert.match(route, /jobSyncChangeStatements/);
  assert.match(crm, /ids: selectedJobIds/);
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

test("both installer Schedule entry paths use the visual dispatch workspace", () => {
  assert.match(crm, /const TradeScheduleWorkspace = dynamic\(\(\) => import\("\.\/TradeScheduleWorkspace"\)/);
  assert.match(crm, /if \(item === "schedule"\) \{ openVisualSchedule\(\); return; \}/);
  assert.match(crm, /onClick=\{\(\) => openVisualSchedule\(\)\} aria-label=\{`Open today's \$\{metrics\.todayVisits\} scheduled visits`\}/);
  assert.match(crm, /view === "schedule"[\s\S]*?<TradeScheduleWorkspace user=\{user\}/);
  assert.match(hub, /onOpenSchedule=\{props\.onOpenSchedule\}/);
  assert.match(dashboard, /workspace === "schedule"[\s\S]*?<TradeScheduleWorkspace user=\{user\}/);
  assert.match(dashboard, /onOpenSchedule=\{\(weekStart\) => \{ setScheduleWeekStart\(weekStart \|\| ""\); setWorkspace\("schedule"\); \}\}/);
});

test("heavy workspaces load dynamically and profile readiness does not wait for opportunities", () => {
  for (const workspace of ["SupplierCatalogueWorkspace", "TradePurchasingWorkspace", "TradeDataImportWorkspace", "TradeScheduleWorkspace", "TradeInvoiceWorkspace", "TradeServiceFollowUpWorkspace"]) {
    assert.match(dashboard, new RegExp(`const ${workspace} = dynamic\\(\\(\\) => import\\("\\./${workspace}"\\)`));
    assert.doesNotMatch(dashboard, new RegExp(`import \\{ ${workspace} \\} from "\\./${workspace}"`));
  }
  for (const workspace of ["TradeIntegrationCentre", "TradeFieldWorkPanel", "TradeTeamCentre", "TradePriceBookWorkspace", "TradeNewJobForm", "TradeQuickInvoicePanel"]) {
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
  assert.match(hub, /onOpenInvoices=\{props\.onOpenInvoices\}/);
  assert.match(dashboard, /const \[scheduleWeekStart, setScheduleWeekStart\] = useState\(""\)/);
  assert.match(dashboard, /initialWeekStart=\{scheduleWeekStart\}/);
  assert.match(dashboard, /onOpenInvoices=\{\(\) => setWorkspace\("invoices"\)\}/);
});

test("CRM writes no longer return the full customer and job workspace", () => {
  assert.equal((route.match(/crmPayload\(identity\)/g) || []).length, 0);
  assert.match(route, /return adminJson\(\{ ok: true, id: workOrderId, workNumber, customerId, serviceSiteId,[\s\S]*appointmentId, photoRequestId, requestSent, deliveryError, quickInvoiceId, invoiceNumber: quickInvoiceReference,[\s\S]*invoiceSent, invoiceDeliveryError, calendarSynced, calendarFailed \}, 201\)/);
  assert.match(route, /return adminJson\(\{ ok: true, id, customerNumber \}, 201\)/);
  assert.match(crm, /CustomerLookupSelect/);
  assert.match(crm, /Name, number, phone, suburb or postcode/);
  assert.match(crm, /pageSize: "25"/);
});

test("customer home records use plain language and progressive disclosure", () => {
  assert.match(customerAssets, /Free home records/);
  assert.match(customerAssets, /Your products, warranties and documents/);
  assert.match(customerAssets, /customer-asset-move-tools/);
  assert.match(customerAssets, /customer-pack-transfer/);
  assert.match(customerLifecycle, /customer-lifecycle-simple/);
  assert.match(customerLifecycle, /Care and warranty reminders/);
});

test("new CRM and customer copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${crm}\n${customerAssets}\n${customerLifecycle}`, /[\u2013\u2014]/);
});
