import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const settings = read("../src/components/TradeTeamSettings.tsx");
const styles = read("../src/components/TradeTeamSettings.module.css");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const business = read("../src/components/TradeBusinessSettingsWorkspace.tsx");
const portal = read("../src/components/TradeTeamPortal.tsx");
const field = read("../src/components/TradeFieldWorkPanel.tsx");
const forms = read("../src/components/TradeJobFormsPanel.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const newJob = read("../src/components/TradeNewJobForm.tsx");
const schedule = read("../src/components/TradeScheduleWorkspace.tsx");
const quote = read("../src/components/TradeQuotePanel.tsx");
const invoice = read("../src/components/TradeQuickInvoicePanel.tsx");

test("Team is a routed first-class workspace and Business links to it", () => {
  assert.match(dashboard, /DashboardWorkspace = "work" \| "team"/);
  assert.match(dashboard, /workspace === "team"/);
  assert.match(dashboard, /People, access and member records/);
  assert.match(dashboard, /window\.addEventListener\("popstate"/);
  assert.match(dashboard, /window\.history\.pushState/);
  assert.match(dashboard, /aria-current=\{workspace === "team"/);
  assert.match(business, /href="\/direct-trade\/dashboard\?workspace=team"/);
  assert.doesNotMatch(business, /<TradeTeamSettings/);
});

test("owner team management keeps access plain, specific and permission-based", () => {
  for (const label of [
    "First name", "Last name", "Email", "Phone", "Create jobs",
    "View quotes", "Create and edit quotes", "Send quotes",
    "Apply discounts", "Assign and reassign jobs", "Reschedule jobs",
    "Edit access permissions", "Manage team members",
    "Own schedule only", "Whole team schedule", "View field documents",
  ]) assert.match(settings, new RegExp(label));
  assert.match(settings, /Manager access/);
  assert.match(settings, /Office access/);
  assert.match(settings, /Field access/);
  assert.match(settings, /Quick access preset/);
  assert.match(settings, /You cannot edit your own access permissions/);
  for (const permission of ["canAssignJobs", "canRescheduleJobs", "canApplyDiscounts", "canEditTeamPermissions"]) {
    assert.match(settings, new RegExp(permission));
  }
  assert.doesNotMatch(settings, /save_role_template|roleTemplateId|permissionsOverridden|Create role/);
  assert.doesNotMatch(settings, /role:\s*formPreset/);
  assert.doesNotMatch(settings, /roleFilter|member\.role|Role<\/th>/);
  assert.doesNotMatch(settings, /canManageSchedule/);
  assert.doesNotMatch(settings, /jobScope === "own"\) next\.canAssignJobs = false/);
});

test("large rosters are searched, filtered and paginated by the server", () => {
  assert.match(settings, /pageSize: "25"/);
  assert.match(settings, /params\.set\("search"/);
  assert.match(settings, /status: statusFilter/);
  assert.match(settings, /capabilityFilter/);
  assert.match(settings, /roster\.totalPages/);
  assert.match(settings, /Page \{roster\.page\} of \{roster\.totalPages\}/);
  assert.match(settings, /className=\{styles\.memberTable\}/);
  assert.match(settings, /className=\{styles\.mobileCards\}/);
  assert.match(settings, /<option value="active">Active<\/option>/);
  assert.match(settings, /<option value="invited">Invited<\/option>/);
  assert.match(settings, /Former or inactive/);
  assert.doesNotMatch(settings, /50 (?:member|seat)/i);
});

test("member lifecycle preserves historical records and has no hard-delete control", () => {
  assert.match(settings, /Deactivate access/);
  assert.match(settings, /Reactivate access/);
  assert.match(settings, /Job history and member documents remain saved/);
  assert.match(settings, /revoked devices and old invitation links remain inactive/);
  assert.match(settings, /!isCurrentMember\(member\).*?member\.status === "active"/);
  assert.doesNotMatch(settings, /delete_member|remove_member|Delete team member|Remove team member/);
  assert.match(settings, /device\.memberStatus === "suspended"/);
  assert.match(settings, /Reactivate this team member before authorising a device/);
});

test("large field device inventories remain searchable and revokable beyond the first page", () => {
  assert.match(settings, /page: String\(devicePage\), pageSize: "25"/);
  assert.match(settings, /params\.set\("search", appliedDeviceQuery\)/);
  assert.match(settings, /params\.set\("status", deviceStatus\)/);
  assert.match(settings, /params\.set\("memberId", deviceMemberId\)/);
  assert.match(settings, /deviceRoster\.totalPages > 1/);
  assert.match(settings, /aria-label="Field device pages"/);
  assert.match(settings, /setDevicePage\(\(current\) => current \+ 1\)/);
  assert.match(settings, /onClick=\{\(\) => void updateDevice\(device, "revoke_device"\)\}/);
});

test("member files support context, touch and protected inline preview", () => {
  assert.match(settings, /onContextMenu/);
  assert.match(settings, />Open<\/button>/);
  assert.match(settings, /role="menu"/);
  assert.match(settings, /Open documents/);
  assert.match(settings, /application\/pdf/);
  assert.match(settings, /URL\.createObjectURL/);
  assert.match(settings, /Delete .* This cannot be undone/);
  assert.match(settings, /Upload a document or credential/);
  assert.match(settings, /name="rentalGate"/);
  assert.match(settings, /licensed_electrician/);
  assert.match(settings, /licensed_gasfitter/);
  assert.match(settings, /suitably_qualified_smoke_alarm_worker/);
  assert.match(settings, /Title<input name="title" required maxLength=\{180\}/);
  assert.match(settings, /credentialType/);
  assert.match(settings, /credentialName/);
  assert.match(settings, /credentialNumber/);
  assert.match(settings, /credentialIssuer/);
  assert.match(settings, /credentialJurisdiction/);
  assert.match(settings, /required=\{Boolean\(uploadRentalGate\)\}/);
  assert.match(settings, /Supporting document or photo<input name="file" type="file" required/);
  assert.match(settings, /notified 30 days before a saved expiry/);
  assert.match(settings, /Maximum 12 MB/);
  assert.match(settings, /blocks optional module sign-off after this credential or supporting file expires/);
  assert.match(settings, /fetch\("\/api\/trade-team\/member-files"/);
});

test("member profiles use a dense contact roster, schedule colour and validated phone input", () => {
  assert.match(settings, /<th>First name<\/th><th>Last name<\/th><th>Phone<\/th><th>Email<\/th><th>Status<\/th><th>Colour<\/th><th>Actions<\/th>/);
  assert.match(settings, /className=\{styles\.memberMenuButton\}/);
  assert.match(settings, /type="tel" inputMode="tel" autoComplete="tel"/);
  assert.match(settings, /filterPhoneInput\(event\.currentTarget\.value\)/);
  assert.match(settings, /Schedule colour/);
  assert.match(settings, /scheduleColours\.map/);
  assert.match(settings, /scheduleColour: String\(data\.get\("scheduleColour"\)/);
  assert.match(settings, /ENERGY_SERVICE_CATALOGUE/);
  assert.match(settings, /capabilities: memberServices/);
});

test("staff portal renders only permission-backed operations", () => {
  assert.match(portal, /permissions\?\.jobScope === "own"/);
  assert.match(portal, /includeWork=1&workPage=1&workPageSize=50/);
  assert.match(portal, /data\.assignees/);
  assert.match(portal, /assigneePage: String\(page\)/);
  assert.match(portal, /assigneeCapability: capability/);
  assert.match(portal, /assigneeSearch/);
  assert.match(portal, /Load more team members/);
  assert.match(portal, /Load more work/);
  assert.match(portal, /data\.work\.page < data\.work\.totalPages/);
  assert.match(portal, /permissions\?\.canAssignJobs/);
  assert.match(portal, /permissions\?\.canManageTeam && <section/);
  assert.match(portal, /<TradeTeamSettings user=\{user\}/);
  assert.doesNotMatch(portal, /TradeInvoiceWorkspace/);
  assert.doesNotMatch(portal, /\{data\.access\.role\} portal/);
  assert.match(portal, /!permissions\?\.canManageJobs/);
  assert.match(portal, /readOnly=\{!permissions\.canManageFieldEvidence\}/);
  assert.match(field, /if \(readOnly\) return/);
  assert.match(forms, /readOnly \? "Review completed field forms"/);
});

test("quote and invoice viewers keep context while every mutation follows exact access", () => {
  assert.match(quote, /const canEditQuote = !readOnly && serverCanManageQuotes/);
  assert.match(quote, /const canSendQuote = canEditQuote && canSend && serverCanSendQuotes/);
  assert.match(quote, /if \(!canEditQuote \|\| !serverCanManageCustomers\) return/);
  assert.match(quote, /canEditQuote && canApplyDiscounts/);
  assert.match(quote, /!canEditQuote && jobSummary\?\.customerId[\s\S]*?Open customer details/);
  assert.match(invoice, /const canManageInvoice = !readOnly && serverCanManageInvoices/);
  assert.match(invoice, /if \(!canManageInvoice\) return/);
  assert.match(invoice, /canManageInvoice && canApplyDiscounts/);
  assert.match(invoice, /canManageInvoice && invoice\.canCorrect/);
  assert.match(invoice, /canManageInvoice && previewOpen/);
});

test("accepted public leads keep disclosed customer and site context inside scoped work", () => {
  assert.match(crm, /const isReleasedLead = job\.customerSource === "public_lead_released"/);
  assert.match(crm, /const jobCustomerName = customer\?\.displayName \|\| job\.customerDisplayName \|\| \(isReleasedLead \? "Customer enquiry"/);
  assert.match(crm, /const customerContactSummary = customer \? \[customer\.phone, customer\.email\]/);
  assert.match(crm, /const siteAddressSummary = jobSite/);
  assert.match(crm, /isReleasedLead \? "Customer-authorised lead"/);
  assert.match(crm, /This accepted job contains only the customer-disclosed contact and property details saved for your business/);
  assert.match(crm, /customerName=\{jobCustomerName\}/);
  assert.match(quote, /jobSummary\?\.siteSummary/);
  assert.match(invoice, /invoice\.document\.customer\.name/);
  assert.match(invoice, /invoice\.document\.site\.summary/);
  assert.doesNotMatch(crm, /Current customer-shared contact and property details appear only in this job's Quote tab/);
});

test("staff schedule loads through its authorised API without opening owner calendar sync", () => {
  const scheduleLoadStart = schedule.indexOf("const load = useCallback");
  const scheduleLoadEnd = schedule.indexOf("}, [rangeStart, user]);", scheduleLoadStart);
  const scheduleLoad = schedule.slice(scheduleLoadStart, scheduleLoadEnd);
  assert.match(scheduleLoad, /fetch\(`\/api\/trade-schedule\?rangeStart=/);
  assert.doesNotMatch(scheduleLoad, /if \(permissions\) return/);
  assert.match(schedule, /if \(permissions\) return;[\s\S]*?fetch\("\/api\/trade-calendar-sync"/);
  assert.match(schedule, /const canRescheduleJobs = !schedulePermissions \|\| schedulePermissions\.canRescheduleJobs/);
  assert.match(schedule, /const canManageAvailability = Boolean\(data\.access\?\.memberId\)/);
  assert.match(schedule, /canManageTeamAvailability\s*\? members\s*:\s*members\.filter\(\(member\) => member\.id === data\.access\?\.memberId\)/);
  assert.match(schedule, /Manage your own availability/);
  assert.doesNotMatch(schedule, /canManageSchedule/);
});

test("delegated field work never offers the unsupported handover route", () => {
  assert.match(field, /canOpenHandover = true/);
  assert.match(field, /\{canOpenHandover && <button[^>]+onClick=\{\(\) => onNavigate\("handover"\)\}>Open handover<\/button>\}/);
  assert.match(crm, /canOpenHandover=\{!permissions\}/);
  assert.match(crm, /const moreTabs:[^=]+ = \[\["tasks"/);
  assert.match(crm, /disabled=\{!canManageJobs \|\| busy === `task-toggle:/);
  assert.match(crm, /\{canManageJobs && <form className="crm-inline-form note"/);
  assert.match(crm, /hideAssets=\{Boolean\(staffPermissions\)\}/);
  assert.match(crm, /\{!permissions && <TradeCommercialHandoffPanel/);
});

test("staff job creation and scoped job context do not leak directory search", () => {
  assert.match(crm, /allowCustomerSearch=\{canSearchCustomerDirectory\}/);
  assert.match(crm, /canAssignJobs=\{!staffPermissions \|\| staffPermissions\.canAssignJobs\}/);
  assert.match(crm, /assignmentScope=\{staffPermissions\?\.jobScope \|\| "team"\}/);
  assert.match(crm, /canSearchCustomerRecords && !isProtected && !isReleasedLead && <CustomerLookupSelect/);
  assert.match(crm, /if \(canSearchCustomerRecords\) update\.crmCustomerId/);
  assert.match(crm, /customer \? \[customer\.phone, customer\.email/);
  assert.match(newJob, /if \(!allowCustomerSearch\) return \[\]/);
  assert.match(newJob, /if \(!allowCustomerSearch \|\| customerMode !== "new"/);
  assert.match(newJob, /assigneePageSize: "25"/);
  assert.match(newJob, /assigneeCapability: serviceCategory/);
  assert.match(newJob, /const canChooseTeamAssignee = canAssignJobs && assignmentScope === "team"/);
  assert.match(newJob, /visibleBootstrapMembers = canChooseTeamAssignee \? teamMembers : selfMember \? \[selfMember\] : \[\]/);
  assert.match(newJob, /if \(!canChooseTeamAssignee\) return/);
  assert.match(newJob, /This scheduled job starts in your own work queue/);
});

test("job appointments use authoritative IDs and paged capability matched assignees", () => {
  assert.match(crm, /assigneeMemberId: string; assigneeLabel: string/);
  assert.match(crm, /const scheduleMemberId = job\.assigneeMemberId/);
  assert.doesNotMatch(crm, /teamMembers\.find\(\(member\) => member\.displayName === job\.assigneeLabel\)/);
  assert.doesNotMatch(crm, /teamMembers\[0\]\?\.id/);
  assert.match(crm, /assigneeCapability: job\.serviceCategory/);
  assert.match(crm, /assigneePageSize: "25"/);
  assert.match(crm, /allowedAppointmentAssignees\.map/);
  assert.match(crm, /appointmentAssigneeRoster\.page < appointmentAssigneeRoster\.totalPages/);
  assert.match(crm, /canAssignJobs && \(!permissions \|\| permissions\.scheduleScope === "team"\)/);
});

test("own-schedule staff cannot view or mutate another worker's appointments", () => {
  assert.match(crm, /type Appointment = \{[^}]*assigneeMemberId: string/);
  assert.match(crm, /const canViewTeamSchedule = !permissions \|\| permissions\.scheduleScope === "team"/);
  assert.match(crm, /job\.appointments\.filter\(\(appointment\) => appointment\.assigneeMemberId === selfMember\?\.id\)/);
  assert.match(crm, /const canViewJobSchedule = canViewTeamSchedule \|\| job\.assigneeMemberId === selfMember\?\.id \|\| visibleJobAppointments\.length > 0/);
  assert.match(crm, /const canAddJobAppointment = canRescheduleJobs && \(canViewTeamSchedule \|\| job\.assigneeMemberId === selfMember\?\.id\)/);
  assert.match(crm, /canViewTeamSchedule \|\| appointment\.assigneeMemberId === selfMember\?\.id/);
  assert.match(crm, /if \(canViewJobSchedule\) mainTabs\.push\(\["schedule", `Schedule \(\$\{visibleJobAppointments\.length\}\)`\]\)/);
  assert.match(crm, /visibleJobAppointments\.map\(\(item\)/);
  assert.match(crm, /\{canCompleteAppointment\(item\) && <button/);
  assert.match(crm, /\{canAddJobAppointment && <form className="crm-inline-form" onSubmit=\{addAppointment\}>/);
  assert.doesNotMatch(crm, /if \(!permissions \|\| permissions\.scheduleScope\) mainTabs\.push/);
});

test("job edits use the exact loaded revision instead of overwriting concurrent changes", () => {
  assert.match(crm, /scheduledEnd: string; revision: number; assigneeMemberId: string/);
  const updateJobPayloads = crm.match(/action: "update_job"[^}]+/g) || [];
  assert.equal(updateJobPayloads.length, 3);
  for (const payload of updateJobPayloads) {
    assert.match(payload, /workOrderId: job\.id, expectedRevision: job\.revision/);
  }
});

test("team member changes use the loaded revision and recover from stale edits", () => {
  assert.match(settings, /updatedAt: string/);
  assert.match(settings, /expectedUpdatedAt: editedMember\?\.updatedAt/);
  assert.match(settings, /expectedUpdatedAt: member\.updatedAt/);
  assert.match(settings, /if \(!isNew && await handleMemberConflict\(response\)\) return/);
  assert.equal((settings.match(/if \(await handleMemberConflict\(response\)\) return/g) || []).length, 2);
  assert.match(settings, /if \(response\.status !== 409\) return false/);
  assert.match(settings, /await load\(\)/);
  assert.match(settings, /This team member changed while you were editing\. The latest details are loaded\. Review them and try again\./);
});

test("team settings are readable and avoid prohibited dash characters", () => {
  assert.doesNotMatch(settings, /[\u2013\u2014]/);
  assert.doesNotMatch(settings, /[✕↓••]/);
  assert.doesNotMatch(styles, /font-size:\s*\.(?:[0-7]\d*)rem/);
  assert.match(styles, /min-height: 44px/);
});
