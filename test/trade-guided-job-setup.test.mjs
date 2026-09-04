import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), "utf8");
const form = read("../src/components/TradeNewJobForm.tsx");
const schedule = read("../src/components/TradeScheduleWorkspace.tsx");
const styles = [
  read("../src/app/globals.css"),
  read("../src/app/protected-workspaces.css"),
].join("\n");
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
const addressProvider = read("../src/lib/address-suggestions-server.ts");
const addressLookup = read("../src/components/AustralianAddressLookup.tsx");
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
  assert.match(workspace, /<h4 id={`job-information-\$\{job\.id\}`}>Job information<\/h4>/);
  assert.match(workspace, /<dt>Job ID<\/dt><dd>\{job\.workNumber\}<\/dd>/);
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
  assert.match(form, /const ordinarySteps = \["Work", "Customer", "Program", "Appointment", "Review"\]/);
  assert.match(form, /const rentalInspectionSteps = \["Work", "Customer", "Inspection", "Appointment", "Review"\]/);
  assert.match(form, /const steps = serviceCategory === "rental-inspection" \? rentalInspectionSteps : ordinarySteps/);
  assert.doesNotMatch(form, /name="title"|datalist/);
  assert.doesNotMatch(workspace, /placeholder="Appointment title"/);
  assert.match(crm, /INSERT INTO trade_crm_appointments/);
  assert.match(crm, /INSERT INTO trade_work_order_compliance_intents/);
  assert.match(crm, /INSERT INTO trade_work_order_events[\s\S]*'compliance_intent_planned'/);
  assert.doesNotMatch(crm, /INSERT INTO trade_crm_photo_requests|sendPhotoRequestDelivery/);
  assert.doesNotMatch(crm, /INSERT INTO trade_crm_quick_invoices|sendQuickInvoiceDelivery/);
  assert.match(workspace, /governed activity form was attached to its draft compliance case and is ready for the assigned technician/);
  assert.match(workspace, /field work is blocked until Creditex completes the governed activity form/);
  assert.match(workspace, /TradePhotoRequestPanel/);
  assert.match(workspace, /TradeQuickInvoicePanel/);
  assert.match(crm, /appointmentTitle = `\$\{displayName\} \$\{SERVICE_LABELS\[serviceCategory\]\}`/);
  assert.match(form, /technician receives the same job, activity and evidence context used by the assigned compliance team/);
});

test("guided appointment setup keeps the authorised week visible and fails closed on conflicts", () => {
  assert.match(form, /import \{ TradeScheduleWorkspace \} from "\.\/TradeScheduleWorkspace"/);
  assert.match(form, /<TradeScheduleWorkspace[\s\S]*variant="job"[\s\S]*proposalStatusId=\{appointmentScheduleStatusId\}/);
  assert.match(form, /onProposalValidation=\{handleAppointmentProposalValidation\}/);
  assert.match(form, /onProposalChange=\{handleAppointmentProposalChange\}/);
  assert.match(form, /appointmentScheduleValidation\.key === appointmentProposalKey[\s\S]*appointmentScheduleValidation\.status === "clear"/);
  assert.match(form, /if \(nextStep === 5 && !appointmentCalendarReady\)/);
  assert.match(form, /if \(!appointmentCalendarReady\) \{[\s\S]*setStep\(4\)/);
  assert.match(form, /disabled=\{!appointmentCalendarReady\}[\s\S]*\{appointmentActionLabel\(\)\}/);
  assert.match(form, /Different workers may overlap; the selected worker may not/);
  assert.match(schedule, /fetch\(`\/api\/trade-schedule\?rangeStart=\$\{rangeStart\}&rangeWeeks=\$\{SCHEDULE_BUFFER_WEEKS\}`/);
  assert.match(schedule, /schedulePermissions\?\.scheduleScope === "own" \? "Your calendar" : "Team calendar"/);
  assert.match(crm, /APPOINTMENT_CONFLICT/);
});

test("guided job creation rechecks the selected worker before and inside its atomic batch", () => {
  const guidedCreate = crm.slice(
    crm.indexOf('if (action === "create_job" || action === "create_scheduled_job")'),
    crm.indexOf('const workOrderId = cleanAdminText(body.workOrderId', crm.indexOf('if (action === "create_job" || action === "create_scheduled_job")')),
  );
  const precheck = guidedCreate.indexOf("await assertTradeScheduleAvailable({");
  const batch = guidedCreate.indexOf("const batchStatements: D1PreparedStatement[] = [");
  const appointmentInsert = guidedCreate.indexOf("INSERT INTO trade_crm_appointments", batch);
  const memberGuard = guidedCreate.indexOf("tradeCrmScheduleMemberGuardStatement", appointmentInsert);
  const eligibilityGuard = guidedCreate.indexOf("tradeJobScheduleEligibilityGuardStatement", appointmentInsert);
  const availabilityGuard = guidedCreate.indexOf("tradeScheduleAvailabilityGuardStatement", appointmentInsert);
  const commit = guidedCreate.indexOf("await db.batch(batchStatements)");

  assert.ok(precheck > 0 && precheck < batch, "availability must be checked before preparing writes");
  assert.ok(appointmentInsert > batch, "the first appointment must be part of the creation batch");
  assert.ok(memberGuard > appointmentInsert && memberGuard < commit, "member capability must be guarded inside the batch");
  assert.ok(eligibilityGuard > appointmentInsert && eligibilityGuard < commit, "job eligibility must be guarded inside the batch");
  assert.ok(availabilityGuard > appointmentInsert && availabilityGuard < commit, "availability must be guarded inside the batch");
  assert.match(guidedCreate.slice(availabilityGuard, commit), /excludeAppointmentId: appointmentId/);
});

test("guided activity forms auto-open only after the job and intent commit", () => {
  const guidedCreate = crm.slice(
    crm.indexOf('if (action === "create_job" || action === "create_scheduled_job")'),
    crm.indexOf('const workOrderId = cleanAdminText(body.workOrderId', crm.indexOf('if (action === "create_job" || action === "create_scheduled_job")')),
  );
  const commit = guidedCreate.indexOf("await db.batch(batchStatements)");
  const autoOpen = guidedCreate.indexOf("await autoOpenReadyPlannedComplianceWorkPacks", commit);
  const calendarSync = guidedCreate.indexOf("syncCreatedAppointmentToConnectedCalendars", autoOpen);

  assert.match(crm, /import \{[\s\S]*autoOpenReadyPlannedComplianceWorkPacks,[\s\S]*\} from "@\/lib\/creditex-compliance-server"/);
  assert.ok(commit > 0 && autoOpen > commit, "the governed form resolver must read the committed job and intent");
  assert.ok(calendarSync > autoOpen, "form attachment readiness must be known before external calendar sync and response");
  assert.match(guidedCreate, /installerUid: identity\.uid,[\s\S]*actorUid: identity\.uid/);
  assert.match(guidedCreate, /workPackReady = preparedComplianceIntents\.length > 0[\s\S]*complianceWorkPacks\.every\(\(item\) => item\.workPackReady\)/);
  assert.match(guidedCreate, /complianceWorkPacks,[\s\S]*workPackReady,[\s\S]*workPackBlockers,/);
  assert.match(guidedCreate, /The job and appointment were saved, but the activity form could not be attached/);
});

test("guided appointment controls align search actions and expand only while scheduling", () => {
  assert.match(form, /className="crm-assignee-search"[\s\S]*<label><span>Find an active teammate<\/span><input[\s\S]*<div><button/);
  assert.match(styles, /\.crm-create-card:has\(\.crm-job-wizard-scheduling\) \{ max-width: 1560px; \}/);
  assert.match(styles, /\.crm-assignee-search > div \{[^}]*display: flex;[^}]*flex-wrap: wrap/);
  assert.match(styles, /\.crm-new-job-schedule-layout > \.job-calendar \{ order: 1; \}/);
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
  assert.match(form, /program\.claimOutputCode === draftClaimOutputCode/);
  assert.match(form, /setDraftProgramTemplateId\(""\);[\s\S]*setDraftActivityTemplateId\(""\)/);
  assert.match(form, /aria-current=\{step === target \? "step" : undefined\}/);
  assert.match(form, /querySelector<HTMLHeadingElement>\(`\[data-step="\$\{step\}"\] h3`\)/);
  assert.match(form, /Saving creates the TLink job, field appointment and attached workflow together/);
});

test("blank guided jobs open mandatory new-customer fields while seeded jobs keep existing-customer mode", () => {
  assert.match(
    form,
    /useState<"existing" \| "new">\(allowCustomerSearch && initial\?\.customerId \? "existing" : "new"\)/,
  );
  assert.match(form, /<strong>New customer<\/strong>[\s\S]*?Find existing customer<\/button>/);
  assert.match(form, /<strong>Find an existing customer<\/strong>[\s\S]*?Create new customer<\/button>/);
  assert.match(form, /<span>Mobile<\/span><input type="tel" name="phone" required=\{step === 2\}/);
  assert.match(form, /<span>Email<\/span><input type="email" name="email" required=\{step === 2\}/);
  assert.doesNotMatch(form, /Mobile, optional|Email, optional/);
});

test("guided jobs collect a bounded deduplicated list of controlled activities", () => {
  assert.match(form, /const MAX_PLANNED_COMPLIANCE_ACTIVITIES = 12/);
  assert.match(form, /useState<PlannedComplianceActivity\[]>\(\[\]\)/);
  assert.match(form, /plannedActivities\.some\(\(item\) =>[\s\S]*item\.programTemplateId === draftProgram\.templateId[\s\S]*item\.activityTemplateId === draftActivity\.templateId/);
  assert.match(form, /That exact government program and activity is already added/);
  assert.match(form, />Add activity<\/button>/);
  assert.match(form, /No government activity added/);
  assert.match(form, /name="complianceActivitiesJson" value=\{complianceActivitiesJson\}/);
  assert.match(form, /const complianceActivitiesJson = JSON\.stringify\(plannedActivities\)/);
  assert.match(form, /legacyComplianceActivity\?\.programTemplateId/);
  assert.match(form, /legacyComplianceActivity\?\.activityTemplateId/);
  for (const label of ["Program", "Activity", "Certificate output", "Product category", "Approved product", "Evidence form", "Calculation"]) {
    assert.match(form, new RegExp(`<dt>${label}</dt>`));
  }
  assert.match(form, /Exact result is generated after the required product, scenario and installation data are verified/);
  assert.match(form, /Creditex product rule mapping required/);
  assert.match(form, /Creditex scenario rule mapping required/);
  assert.doesNotMatch(form, /calculation\.state\.replaceAll|partial estimate available|deterministic local estimate/i);
  assert.match(form, /plannedActivityDetails\.map/);
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
    /function changeServiceCategory\(value: string\)[\s\S]*setServiceCategory\(value\);[\s\S]*clearCompliancePlan\(\)/,
  );
  assert.match(
    form,
    /<AddressFields user=\{user\} value=\{newAddress\} onChange=\{\(value\) => \{[\s\S]*setNewAddress\(value\);[\s\S]*clearCompliancePlan\(\)/,
  );
  assert.match(
    form,
    /Government program<\/span><select[\s\S]*setHighestStep\(\(current\) => Math\.min\(current, 3\)\); setDraftProgramTemplateId/,
  );
  assert.doesNotMatch(form, /changeServiceCategory\(activity\.serviceCategory/);
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
  assert.match(address, /fetchAustralianAddressSuggestions/);
  assert.match(addressProvider, /maps\.googleapis\.com/);
  assert.match(addressProvider, /components", "country:AU/);
  assert.match(addressProvider, /administrative_area_level_1/);
  assert.match(address, /configured: false, suggestions: \[\]/);
  assert.match(form, /<AustralianAddressLookup/);
  assert.match(form, /endpoint="\/api\/trade-address-suggestions"/);
  assert.match(form, /getAuthorization=\{getAuthorization\}/);
  assert.match(addressLookup, /role="combobox"/);
  assert.match(addressLookup, /role="listbox"/);
  assert.match(addressLookup, /aria-live="polite"/);
  assert.match(addressLookup, /enter the address manually/i);
});

test("planning starts with the job while governed compliance remains source controlled", () => {
  assert.doesNotMatch(form, /name="complianceActivityVersionId"/);
  assert.doesNotMatch(form, /\/api\/trade-compliance/);
  assert.match(form, /name="complianceIntentMode"/);
  assert.match(form, /name="complianceActivitiesJson"/);
  assert.match(form, /name="programTemplateId"/);
  assert.match(form, /name="activityTemplateId"/);
  assert.match(form, /assigned compliance team can review the customer, site, activity and schedule/);
  assert.match(crm, /governed activity version is resolved during compliance review/);
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
