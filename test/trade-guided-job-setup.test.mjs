import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");
const form = read("../src/components/TradeNewJobForm.tsx");
const workspace = read("../src/components/InstallerCrmWorkspace.tsx");
const enquiryInbox = read("../src/components/TradeEnquiryInbox.tsx");
const crm = read("../src/app/api/trade-crm/route.ts");
const numbers = read("../src/lib/trade-job-number-server.ts");
const workOrders = read("../src/app/api/trade-work-orders/route.ts");
const recurring = read("../src/lib/trade-recurring-jobs-server.ts");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0074_global_tlink_job_numbers.sql");
const adminJobs = read("../src/app/api/admin/jobs/route.ts");
const adminDirectory = read("../src/components/AdminJobDirectory.tsx");
const address = read("../src/app/api/trade-address-suggestions/route.ts");
const complianceCatalogue = read("../src/app/api/trade-compliance/route.ts");
const complianceDomain = read("../src/lib/creditex-compliance-server.ts");
const complianceIntake = read("../src/components/TradeComplianceIntake.tsx");
const acceptedHandoffMigration = read("../drizzle/0101_compliance_accepted_handoff.sql");

test("new jobs use one globally sequenced TLink ID across every creation path", () => {
  assert.match(numbers, /__tlink_global__/);
  assert.match(numbers, /formatTlinkJobNumber\(value\)/);
  assert.match(numbers, /TLINK_JOB_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"/);
  assert.match(numbers, /Every operation is a permutation over 32 bits/);
  assert.match(crm, /nextTlinkJobNumber\(db, now\)/);
  assert.match(workOrders, /prefix === "JOB"[\s\S]*nextTlinkJobNumber\(db, now\)/);
  assert.match(recurring, /nextTlinkJobNumber\(db, now\)/);
  assert.match(schema, /trade_work_orders_tlink_job_number_idx/);
  assert.match(migration, /ROW_NUMBER\(\) OVER \(ORDER BY created_at, id\)/);
  assert.match(migration, /SET work_number =/);
  assert.match(migration, /INSERT INTO trade_crm_counters/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_work_orders_tlink_job_number_idx`/);
});

test("admin and installer expose and search the same job ID", () => {
  assert.match(form, /TLink job ID/);
  assert.match(form, /TLJ-X3KHTUEF/);
  assert.match(adminDirectory, /TLJ-X3KHTUEF/);
  assert.doesNotMatch(`${form}\n${adminDirectory}`, /TLJ-00000124/);
  assert.match(workspace, /This same ID is used by your team, Creditex and TLink support/);
  assert.match(adminJobs, /LOWER\(w\.work_number\) LIKE/);
  assert.match(adminJobs, /LOWER\(w\.id\) LIKE/);
  assert.match(adminJobs, /installer_business/);
});

test("guided setup attaches duplicates and creates one appointment plus planned compliance intent", () => {
  assert.match(form, /find_customer_duplicates/);
  assert.match(form, /Use this customer/);
  assert.match(enquiryInbox, /Create job from enquiry/);
  assert.match(enquiryInbox, /sourceEnquiryId: detail\.id/);
  assert.match(workspace, /setNewJobSeed\(seed\)[\s\S]*setCreating\("job"\)/);
  assert.match(form, /const steps = \["Work", "Customer", "Program", "Appointment", "Review"\]/);
  assert.doesNotMatch(form, /name="title"|datalist/);
  assert.doesNotMatch(workspace, /placeholder="Appointment title"/);
  assert.match(crm, /INSERT INTO trade_crm_appointments/);
  assert.match(crm, /INSERT INTO trade_work_order_compliance_intents/);
  assert.match(crm, /INSERT INTO trade_work_order_events[\s\S]*'compliance_intent_planned'/);
  assert.doesNotMatch(crm, /INSERT INTO trade_crm_photo_requests|sendPhotoRequestDelivery/);
  assert.doesNotMatch(crm, /INSERT INTO trade_crm_quick_invoices|sendQuickInvoiceDelivery/);
  assert.match(workspace, /planned government activity is visible to Creditex for setup review/);
  assert.match(workspace, /TradePhotoRequestPanel/);
  assert.match(workspace, /TradeQuickInvoicePanel/);
  assert.match(crm, /appointmentTitle = `\$\{displayName\} \$\{SERVICE_LABELS\[serviceCategory\]\}`/);
  assert.match(form, /technician receives the same job, program and evidence context that Creditex audits/);
});

test("enquiry handoff keeps the selected service site and safely supports customers without one", () => {
  assert.match(enquiryInbox, /serviceSiteId: decision === "use_existing" \? existingServiceSiteId : ""/);
  assert.match(enquiryInbox, /createNewSite: !result\.serviceSiteId/);
  assert.match(form, /createNewSite\?: boolean/);
  assert.match(form, /useState\(Boolean\(initial\?\.createNewSite\)\)/);
  assert.match(form, /sites\.some\(\(site\) => site\.id === serviceSiteId\)/);
  assert.match(form, /Choose an existing service site, or add a new service site/);
  assert.match(form, /customerMode === "existing" && customerId && !loadingSites && !siteLoadError && sites\.length > 0/);
});

test("certificate planning cascades from output type to jurisdiction program and activity", () => {
  assert.match(form, /Certificate or support type/);
  assert.match(form, /claimOutputOptions/);
  assert.match(form, /program\.claimOutputCode === claimOutputCode/);
  assert.match(form, /setProgramTemplateId\(""\);[\s\S]*setActivityTemplateId\(""\)/);
  assert.match(form, /aria-current=\{step === target \? "step" : undefined\}/);
  assert.match(form, /querySelector<HTMLHeadingElement>\(`\[data-step="\$\{step\}"\] h3`\)/);
  assert.match(form, /Saving creates the TLink job, field appointment and Creditex intake together/);
});

test("enquiry selection ignores stale detail responses and refreshes only the current record", () => {
  assert.match(enquiryInbox, /const detailRequestSequence = useRef\(0\)/);
  assert.match(enquiryInbox, /const selectedIdRef = useRef\(""\)/);
  assert.match(
    enquiryInbox,
    /requestId !== detailRequestSequence\.current \|\| selectedIdRef\.current !== id/,
  );
  assert.match(
    enquiryInbox,
    /const currentSelectedId = selectedIdRef\.current;[\s\S]*loadDetail\(currentSelectedId\)/,
  );
  assert.match(
    enquiryInbox,
    /return \(\) => \{[\s\S]*detailRequestSequence\.current \+= 1;[\s\S]*cancelAnimationFrame/,
  );
});

test("guided setup clears incompatible plans and recovers when customer sites cannot load", () => {
  assert.match(
    form,
    /function clearCompliancePlan\(\)[\s\S]*setHighestStep\(\(current\) => Math\.min\(current, step\)\)/,
  );
  assert.match(
    form,
    /function changeServiceCategory\(value: string, preserveCompliance = false\)[\s\S]*if \(!preserveCompliance\) clearCompliancePlan\(\)/,
  );
  assert.match(
    form,
    /<AddressFields user=\{user\} value=\{newAddress\} onChange=\{\(value\) => \{[\s\S]*setNewAddress\(value\);[\s\S]*clearCompliancePlan\(\)/,
  );
  assert.match(
    form,
    /Government program<\/span><select[\s\S]*setHighestStep\(\(current\) => Math\.min\(current, 3\)\); setProgramTemplateId/,
  );
  assert.match(form, /changeServiceCategory\(activity\.serviceCategory, true\)/);
  assert.match(
    form,
    /const customer = result\.customer;[\s\S]*if \(!response\.ok \|\| !customer\)/,
  );
  assert.match(form, /Retry customer sites/);
  assert.match(form, /Add a new service site instead/);
  assert.match(form, /disabled=\{checkingDuplicates \|\| loadingSites\}/);
});

test("planned certificate work defaults to Installation without locking the appointment", () => {
  assert.match(
    form,
    /setAppointmentType\(\(current\) => \{[\s\S]*return "installation"/,
  );
  assert.doesNotMatch(form, /disabled=\{complianceMode === "planned" && value !== "installation"\}/);
  assert.doesNotMatch(form, /Certificate planning must use an Installation appointment/);
  assert.match(form, /Installation is recommended for certificate work, but earlier field visits can also start the job/);
});

test("address search supports structured Google Australian results and manual fallback", () => {
  assert.match(address, /googleapis\.com/);
  assert.match(address, /components", "country:AU/);
  assert.match(address, /administrative_area_level_1/);
  assert.match(address, /configured: false, suggestions: \[\]/);
  assert.match(form, /enter the address manually/i);
});

test("planning starts with the job while governed compliance remains source controlled", () => {
  assert.doesNotMatch(form, /name="complianceActivityVersionId"/);
  assert.doesNotMatch(form, /\/api\/trade-compliance/);
  assert.match(form, /name="complianceIntentMode"/);
  assert.match(form, /name="programTemplateId"/);
  assert.match(form, /name="activityTemplateId"/);
  assert.match(form, /This creates the Creditex intake with the job/);
  assert.match(crm, /governed activity version is resolved by TLink and Creditex/);
  assert.doesNotMatch(crm, /appendLiveComplianceCaseStatements\(db, batchStatements/);
  assert.match(crm, /resolveTradeComplianceIntent/);
  assert.match(crm, /INSERT INTO trade_work_order_compliance_intents/);
  assert.match(workspace, /TradeComplianceIntake/);

  assert.match(complianceIntake, /new URLSearchParams\(\{ workOrderId \}\)/);
  assert.match(complianceIntake, /seenCursors/);
  assert.match(complianceIntake, /<span>Program<\/span>/);
  assert.match(complianceIntake, /<span>Activity<\/span>/);
  assert.match(complianceIntake, /<span>Product category<\/span>/);
  assert.match(complianceIntake, /<span>Activity scenario<\/span>/);
  assert.match(complianceIntake, /<span>Effective source version<\/span>/);
  assert.match(complianceIntake, /workOrderId,[\s\S]*activityVersionId: effectiveActivityVersionId,[\s\S]*idempotencyKey/);
  assert.doesNotMatch(complianceIntake, /6\(23\)|synthetic/i);

  assert.match(complianceCatalogue, /requireVerifiedTradeAccess\(request, \{/);
  assert.match(complianceCatalogue, /work\.service_category/);
  assert.match(complianceCatalogue, /work\.scheduled_start/);
  assert.match(complianceCatalogue, /appointment\.appointment_type = 'installation'/);
  assert.match(crm, /appointmentType === "installation"[\s\S]*UPDATE trade_work_orders[\s\S]*scheduled_start = \?/);
  assert.match(complianceCatalogue, /service_site\.address_state/);
  assert.doesNotMatch(complianceCatalogue, /ensureAcceptedCommercialHandoff|ACCEPTED_HANDOFF_REQUIRED/);
  assert.match(complianceCatalogue, /actorType: "installer"/);
  assert.match(complianceCatalogue, /listInstallerSelectableActivities/);
  assert.match(complianceCatalogue, /AUSTRALIAN_SITE_JURISDICTIONS\.includes/);
  assert.match(complianceCatalogue, /ACTIVITY_DATE_REQUIRED/);
  assert.match(complianceCatalogue, /ACTIVITY_PAGE_SIZE \+ 1/);
  assert.match(complianceCatalogue, /nextCursor: hasNext \? activities\.at\(-1\)\?\.id/);
  assert.match(complianceCatalogue, /const POST_FIELDS = new Set\(\[[\s\S]*"workOrderId"[\s\S]*"activityVersionId"[\s\S]*"idempotencyKey"[\s\S]*"commercialHandoffId"[\s\S]*"acceptedQuoteVersionId"[\s\S]*"acceptedScopeSha256"/);
  assert.match(complianceCatalogue, /typeof parsedBody !== "object"[\s\S]*Array\.isArray\(parsedBody\)/);
  assert.match(complianceCatalogue, /COMPLIANCE_HANDOFF_INCOMPLETE/);
  assert.match(complianceCatalogue, /appendLiveComplianceCaseStatements/);
  assert.match(complianceCatalogue, /actorType: "installer"/);
  assert.match(acceptedHandoffMigration, /compliance_cases_active_work_order_idx/);
  assert.match(acceptedHandoffMigration, /WHERE `status` <> 'closed'/);
  assert.match(complianceDomain, /ACTIVITY_CATEGORY_MISMATCH/);
  assert.match(complianceDomain, /ACTIVITY_JURISDICTION_MISMATCH/);
  assert.match(workspace, /This is not an eligibility decision, certificate calculation, evidence acceptance or rebate promise/);
});
