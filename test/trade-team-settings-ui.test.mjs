import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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
const quotePreview = read("../src/components/TradeQuoteLivePreview.tsx");
const invoice = read("../src/components/TradeQuickInvoicePanel.tsx");
const memberFilesRoute = read("../src/app/api/trade-team/member-files/route.ts");

test("member service regions save explicitly and show failures inside the editing dialog", () => {
  assert.match(settings, /serviceStates: memberServiceStates/);
  assert.match(settings, /setMemberServiceStates\(savedMember\.assignedServiceStates \?\? null\)/);
  assert.match(settings, /fieldset className=\{styles.permissionGroup\} disabled=\{Boolean\(busy\)\}><legend>Service regions/);
  assert.match(settings, /fieldset className=\{styles.permissionGroup\} disabled=\{Boolean\(busy\)\}><legend>Services performed on site/);
  assert.match(settings, /onSubmit=\{saveMember\}>\s*\{error && <p className=\{styles.error\} role="alert"/);
});

test("Team is a routed first-class workspace and Business links to it", () => {
  const workspaceType = dashboard.match(/type DashboardWorkspace\s*=([^;]+);/);
  const workspaceRegistry = dashboard.match(/const dashboardWorkspaces = new Set<DashboardWorkspace>\(\[([\s\S]*?)\]\)/);
  assert.ok(workspaceType);
  assert.ok(workspaceRegistry);
  for (const name of ["work", "team"]) {
    assert.ok(Array.from(workspaceType[1].matchAll(/"([^"]+)"/g), match => match[1]).includes(name));
    assert.ok(Array.from(workspaceRegistry[1].matchAll(/"([^"]+)"/g), match => match[1]).includes(name));
  }
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
  assert.match(settings, /Your personal name is used for technician sign-off when a job is assigned to you/);
  assert.match(settings, /TLink will not use the business name as the signer/);
  assert.match(settings, /firstName: String\(data\.get\("firstName"\)/);
  assert.match(settings, /lastName: String\(data\.get\("lastName"\)/);
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
  assert.match(settings, /!isCurrentMember\(editing\)[\s\S]*?editing\.status === "active"/);
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
  assert.match(settings, /member\.isOwner \? "Set up my app" : "Open details"/);
  assert.match(settings, /role="menu"/);
  assert.match(settings, /Open documents/);
  assert.match(settings, /application\/pdf/);
  assert.match(settings, /URL\.createObjectURL/);
  assert.match(settings, /Delete .* This cannot be undone/);
  assert.match(settings, /Upload a document or credential/);
  assert.match(settings, /name="rentalGate"/);
  assert.match(settings, /licensed_electrician/);
  assert.match(settings, /licensed_gasfitter/);
  assert.match(settings, /<option value="licensed_plumber">Licensed plumber licence<\/option>/);
  assert.match(settings, /<option value="registered_plumber">Registered plumber registration<\/option>/);
  assert.match(settings, /<option value="refrigerant_handler">Refrigerant handling licence<\/option>/);
  assert.match(settings, /suitably_qualified_smoke_alarm_worker/);
  assert.match(settings, /sres_installer_accreditation/);
  assert.match(settings, /sres_designer_accreditation/);
  assert.match(settings, /Solar Accreditation Australia/);
  assert.match(settings, /Title<input name="title" required maxLength=\{180\}/);
  assert.match(settings, /credentialType/);
  assert.match(settings, /credentialName/);
  assert.match(settings, /credentialNumber/);
  assert.match(settings, /credentialIssuer/);
  assert.match(settings, /credentialJurisdiction/);
  assert.match(settings, /required=\{Boolean\(uploadRentalGate\) \|\| uploadCategory === "insurance"\}/);
  assert.match(settings, /<option value="insurance">Insurance<\/option>/);
  assert.match(settings, /Renewal due within 30 days/);
  assert.match(settings, /Expired: renewal needed/);
  assert.match(settings, /Supporting document or photo<input name="file" type="file" required/);
  assert.match(settings, /notified 30 days before a saved expiry/);
  assert.match(settings, /Maximum 12 MB/);
  assert.match(settings, /reuses the saved credential details in field forms and prevents sign-off after the credential or supporting file expires/);
  assert.match(settings, /fetch\("\/api\/trade-team\/member-files"/);
  assert.match(memberFilesRoute, /"sres_installer_accreditation"/);
  assert.match(memberFilesRoute, /"sres_designer_accreditation"/);
  for (const role of ["licensed_plumber", "registered_plumber", "refrigerant_handler"]) {
    assert.match(memberFilesRoute, new RegExp(`\\["${role}", "(?:licence|registration)"\\]`));
  }
  assert.match(memberFilesRoute, /EXACT_TRADE_CREDENTIAL_TYPES\.get\(rentalGate\)/);
  assert.match(memberFilesRoute, /credentialType !== "accreditation" \|\| credentialJurisdiction !== "NATIONAL"/);
  assert.match(settings, /!isSresCredential && <option value="VIC">Victoria<\/option>/);
  assert.match(settings, /uploadRentalGate === "registered_plumber" \? "registration"/);
  assert.match(settings, /uploadRentalGate === "licensed_plumber" \|\| uploadRentalGate === "refrigerant_handler" \? "licence"/);
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
  assert.match(settings, /fieldUsername: fieldUsernameDraft\.trim\(\)/);
  assert.match(settings, /TLink username/);
  assert.match(settings, /Generate and email PIN/);
  assert.match(settings, /Set up my app/);
  assert.match(settings, /TLink emails the username and PIN/);
  assert.match(settings, /result\.code !== "REVISION_CONFLICT"/);
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
  assert.match(quote, /if \(!canEditQuote \|\| !serverCanManageCustomers \|\| busy\) return/);
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
  assert.match(crm, /This customer-authorised lead contains only the contact and property details disclosed to your business/);
  assert.match(crm, /customerName=\{jobCustomerName\}/);
  assert.match(quote, /<TradeQuoteLivePreview[^>]*job=\{jobSummary\}/);
  assert.match(quotePreview, /job\?\.siteSummary/);
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
  assert.match(schedule, /if \(permissions \|\| jobCalendar\) return;[\s\S]*?fetch\("\/api\/trade-calendar-sync"/);
  assert.match(schedule, /const canRescheduleJobs = !schedulePermissions \|\| schedulePermissions\.canRescheduleJobs/);
  assert.match(schedule, /const canManageAvailability = Boolean\(data\.access\?\.memberId\)/);
  assert.match(schedule, /canManageTeamAvailability\s*\? members\s*:\s*members\.filter\(\(member\) => member\.id === data\.access\?\.memberId\)/);
  assert.match(schedule, /Manage your own availability/);
  assert.doesNotMatch(schedule, /canManageSchedule/);
});

test("delegated field work never offers the unsupported handover route", () => {
  assert.match(field, /canOpenHandover = true/);
  assert.match(field, /\{canOpenHandover && data\.fieldJob\.completion\.handoverReady && <button[^>]+onClick=\{\(\) => onNavigate\("handover"\)\}>Open handover<\/button>\}/);
  assert.match(crm, /canOpenHandover=\{!permissions && !isLost\}/);
  assert.match(crm, /const moreTabs:[^=]+ = \[\["tasks"/);
  assert.match(crm, /disabled=\{isImported \|\| !canManageJobs \|\| busy === `task-toggle:/);
  assert.match(crm, /\{canManageJobs && <form className="crm-inline-form note"/);
  assert.doesNotMatch(crm, /hideAssets|Assets and history/, "The removed customer asset panel cannot expose an owner-only route to staff");
  assert.match(crm, /\{!permissions && !isLost && <TradeCommercialHandoffPanel/);
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

test("job scheduling combines the selected assignee and first booking without remounting the job", () => {
  const addAppointment = crm.match(/async function addAppointment\([\s\S]*?(?=\n\s*async function completeAppointment)/)?.[0] || "";
  assert.match(crm, /assigneeMemberId: string; assigneeLabel: string/);
  assert.doesNotMatch(crm, /teamMembers\.find\(\(member\) => member\.displayName === job\.assigneeLabel\)/);
  assert.doesNotMatch(crm, /teamMembers\[0\]\?\.id/);
  assert.match(addAppointment, /action: "create_appointment"/);
  assert.match(addAppointment, /expectedRevision: job\.revision/);
  assert.match(addAppointment, /assigneeMemberId: jobAssigneeId/);
  assert.doesNotMatch(addAppointment, /assigneeMemberId: job\.assigneeMemberId/);
  assert.match(addAppointment, /setBookingDraftOpen\(false\)/);
  assert.doesNotMatch(crm, /Save assignment first|Save the changed assignment before booking|Save the person first/);
  assert.doesNotMatch(crm, /key=\{`[^\n]*selectedJobDetail\.assigneeMemberId/);
  assert.match(crm, /const bookingCalendarReady = appointmentScheduleValidation\.key === bookingProposalKey && appointmentScheduleValidation\.status === "clear"/);
  assert.match(crm, /const bookingSubmitBlocked = [^;]*!bookingCalendarReady/);
  assert.match(crm, /appointmentScheduleValidation\.status !== "clear"/);
  assert.match(crm, /onProposalValidation=\{handleProposalValidation\}/);
  assert.match(crm, /focusedMemberId=\{jobAssigneeId\}/);
  assert.match(crm, /proposal=\{bookingDraftOpen && canAddJobAppointment \?/);
  assert.match(crm, /aria-describedby=\{proposalStatusId\}/);
  assert.match(crm, /assigneeMemberId: jobAssigneeId/);
  assert.match(crm, /assigneeCapability: job\.serviceCategory/);
  assert.match(crm, /assigneePageSize: "50"/);
  assert.match(crm, /for \(let page = 2; page <= \(roster\?\.totalPages \|\| 1\); page \+= 1\)/);
  assert.match(crm, /allowedJobAssignees\.map/);
  assert.match(crm, /setBookingDraftOpen\(true\); \}\}>Add another appointment<\/button>/);
  assert.doesNotMatch(crm, /appointmentAssigneeRoster|allowedAppointmentAssignees|Find an active teammate/);
});

test("the combined Schedule tab respects own-schedule visibility and remains available to assigners", () => {
  assert.match(crm, /type Appointment = \{[^}]*assigneeMemberId: string/);
  assert.match(crm, /const canViewTeamSchedule = !permissions \|\| permissions\.scheduleScope === "team"/);
  assert.match(crm, /job\.appointments\.filter\(\(appointment\) => appointment\.assigneeMemberId === selfMember\?\.id\)/);
  assert.match(crm, /const canViewJobSchedule = canViewTeamSchedule \|\| job\.assigneeMemberId === selfMember\?\.id \|\| visibleJobAppointments\.length > 0/);
  assert.match(crm, /const canOpenJobSchedule = !isProtected && \(canAssignJobs \|\| canViewJobSchedule\)/);
  assert.match(crm, /const canAddJobAppointment = jobReadyForScheduling && canRescheduleJobs/);
  assert.match(crm, /const canPrepareJobAppointment = jobReadyForScheduling && canRescheduleJobs && \(canAssignJobs \|\| canAddJobAppointment\)/);
  assert.match(crm, /const canStartJobScheduling = canPrepareJobAppointment/);
  assert.match(crm, /const jobReadyForScheduling = !isImported && job\.scheduleReady/);
  assert.match(crm, /Wait for the customer to accept the current quote before adding an appointment/);
  assert.match(crm, /canViewTeamSchedule \|\| appointment\.assigneeMemberId === selfMember\?\.id/);
  assert.match(crm, /if \(canOpenJobSchedule\) mainTabs\.push\(\["schedule", `Schedule \(\$\{visibleJobAppointments\.length\}\)`\]\)/);
  assert.match(crm, /visibleJobAppointments\.map\(\(item\)/);
  assert.match(crm, /\{canCompleteAppointment\(item\) && <button/);
  assert.match(crm, /<form className="crm-job-booking-form" onSubmit=\{addAppointment\}>/);
  assert.doesNotMatch(crm, /mainTabs\.push\(\["assignment"/);
  assert.doesNotMatch(crm, /activeTab === "assignment"/);
  const scheduleSection = crm.match(/\{activeTab === "schedule"[\s\S]*?(?=\n\s*\{activeTab === ")/)?.[0] || "";
  assert.match(scheduleSection, /<TradeScheduleWorkspace/);
  assert.match(scheduleSection, /variant="job"/);
  assert.match(scheduleSection, /permissions=\{permissions\}/);
  assert.match(scheduleSection, /<select value=\{jobAssigneeId\}/);
  assert.doesNotMatch(scheduleSection, /Save assignment|crm-job-assignment-form/);
  assert.doesNotMatch(crm, /if \(!permissions \|\| permissions\.scheduleScope\) mainTabs\.push/);
  assert.match(crm, /const canOpenScheduleAction = !staffPermissions \|\| staffPermissions\.canAssignJobs/);
  assert.match(crm, /job\.assigneeMemberId === selfMemberId/);
  assert.match(crm, /setJobScheduleRefreshNonce\(\(value\) => value \+ 1\)/);
  assert.match(crm, /onScheduleJob=\{canStartJobScheduling && !isReleasedLead \? \(\) => setTab\("schedule"\) : undefined\}/);
});

test("job edits use the exact loaded revision instead of overwriting concurrent changes", () => {
  assert.match(crm, /scheduledEnd: string; revision: number; assigneeMemberId: string/);
  const updateJobPayloads = crm.match(/action: "update_job"[^}]+/g) || [];
  assert.equal(updateJobPayloads.length, 4);
  assert.equal(updateJobPayloads.filter((payload) => /activateImported: true, stage: "backlog", pipelineStage: "enquiry"/.test(payload)).length, 1);
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
  assert.doesNotMatch(settings, /[\u2715\u2193\u2022]/);
  assert.doesNotMatch(styles, /font-size:\s*\.(?:[0-7]\d*)rem/);
  assert.match(styles, /min-height: 44px/);
});

test("team invitations report actual email delivery and offer a direct resend", () => {
  assert.match(settings, /result\.delivery\?\.status === "sent"/);
  assert.match(settings, /setError\(result\.delivery\?\.message/);
  assert.match(settings, /Invitation delivery could not be confirmed/);
  assert.match(settings, /"Send new invitation"/);
  assert.match(settings, /Send new portal invitation to/);
  assert.match(settings, /Adding a person with an email sends their team invitation automatically/);
  assert.match(settings, /Copy invitation link/);
  assert.doesNotMatch(settings, /Fresh login link created|Refresh office login link|Create office login link/);
});

test("portal invitation and login controls are separate from field app PIN access", () => {
  const portalPanel = settings.slice(settings.indexOf('aria-label="TLink portal access"'), settings.indexOf('aria-label="TLink app access"'));
  const appPanel = settings.slice(settings.indexOf('aria-label="TLink app access"'), settings.indexOf('{editingOwner && trainingTodos}'));
  assert.match(portalPanel, /Send new invitation/);
  assert.match(portalPanel, /Copy portal login/);
  assert.match(portalPanel, /href="\/direct-trade\/team"/);
  assert.match(portalPanel, /\{invitationPanel\}/);
  assert.match(settings, /!editing && invitationPanel/);
  assert.doesNotMatch(appPanel, /createLogin\(editing\)/);
  assert.match(appPanel, /Generate and email PIN/);
});

test("quick reinvite renews expired invitations using saved membership without overwriting access", async () => {
  const handler = settings.slice(settings.indexOf("  async function createLogin("), settings.indexOf("  async function updateMemberStatus("));
  const script = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const member = { id: "member-1", email: "member@example.test", hasLogin: false, invitePending: false, updatedAt: "saved-revision" };
  const requests = []; const links = []; const errors = [];
  await runInNewContext(`(async () => { ${script}; await createLogin(member); })()`, {
    member,
    setMenu() {}, setInviteUrl: value => links.push(value), setInviteDelivery() {}, setBusy() {}, setError: value => errors.push(value), setMessage() {},
    tokenHeaders: async () => ({ Authorization: "Bearer test" }),
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true, invite: { inviteUrl: "https://tlink.example/direct-trade/team?invite=fresh" }, delivery: { status: "sent", message: "Submitted" } }) }; },
    handleMemberConflict: async () => false,
    load: async () => ({ members: [{ ...member, updatedAt: "new-revision" }] }),
    setEditing: fn => assert.equal(fn(member).updatedAt, "new-revision"),
  });
  assert.deepEqual(requests, [{ url: "/api/trade-team", body: { action: "reissue_invite", memberId: "member-1", expectedUpdatedAt: "saved-revision" } }]);
  assert.equal(links.at(-1), "https://tlink.example/direct-trade/team?invite=fresh");
  assert.deepEqual(errors, [""]);
});

test("a pending invitation cannot be displayed against another member", () => {
  const handlers = [
    settings.slice(settings.indexOf("  function openNew("), settings.indexOf("  function searchMembers(")),
    settings.slice(settings.indexOf("  function openEdit("), settings.indexOf("  function applyPreset(")),
  ];
  for (const [index, handler] of handlers.entries()) {
    const script = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    // No state setter is available: either entry must return before it can
    // replace the selected member or clear the pending invitation state.
    runInNewContext(`${script}; ${index === 0 ? "openNew()" : "openEdit({ id: 'other-member' })"};`, { busy: "invite:member-1" });
  }
  assert.match(settings, /disabled=\{Boolean\(busy\)\} onClick=\{openNew\}/);
  assert.doesNotMatch(settings, /(?<!disabled=\{Boolean\(busy\)\} )onClick=\{\(\) => openEdit\(member\)\}/);
});

const settingsAst = ts.createSourceFile("TradeTeamSettings.tsx", settings, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const settingsComponent = settingsAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TradeTeamSettings");
function teamHandler(name, context) {
  const declaration = settingsComponent.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Production handler ${name} exists`);
  const script = ts.transpileModule(declaration.getText(settingsAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`${script}; ${name}`, context);
}

const archiveMember = { id: "staff-1", firstName: "Katja", lastName: "Rosic", email: "katja@example.test", phone: "0400000000", fieldUsername: "katja", status: "active", isOwner: false, hasLogin: true, updatedAt: "loaded-revision", fileCount: 2, permissions: { jobScope: "own" } };
const memberLabel = member => `${member.firstName} ${member.lastName}`;

test("Delete archives the exact loaded member revision after confirmation and refreshes roster and revoked devices", async () => {
  const requests = []; const confirmations = []; const messages = []; const refreshes = [];
  const archive = teamHandler("updateMemberStatus", {
    busy: "", isCurrentMember: () => false, memberLabel,
    window: { confirm: text => { confirmations.push(text); return true; } },
    setBusy() {}, setError() {}, setMessage: value => messages.push(value), setMenu() {}, setEditing() {},
    tokenHeaders: async () => ({ Authorization: "Bearer fixture" }),
    fetch: async (url, options) => { requests.push({ url, method: options.method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; },
    handleMemberConflict: async () => false,
    load: async () => refreshes.push("roster"), loadDevices: async () => refreshes.push("devices"),
  });
  await archive(archiveMember, "archived");
  assert.deepEqual(requests, [{ url: "/api/trade-team", method: "PATCH", body: { action: "archive_member", memberId: "staff-1", expectedUpdatedAt: "loaded-revision" } }]);
  assert.match(confirmations[0], /access will be revoked.*Archived team.*history, documents and audit records will remain saved/);
  assert.deepEqual(refreshes, ["roster", "devices"]);
  assert.match(messages.at(-1), /archived and access revoked/);
});

test("archive cancellation, owner, self, archived records and pending mutations cannot dispatch a deletion", async () => {
  for (const fixture of [
    { member: archiveMember, confirmed: false },
    { member: { ...archiveMember, isOwner: true } },
    { member: archiveMember, current: true },
    { member: { ...archiveMember, status: "archived" } },
    { member: archiveMember, busy: "member" },
  ]) {
    const archive = teamHandler("updateMemberStatus", {
      busy: fixture.busy || "", isCurrentMember: () => fixture.current || false, memberLabel,
      window: { confirm: () => fixture.confirmed ?? true },
      // Any state change or request would fail: none should be reached.
    });
    await archive(fixture.member, "archived");
  }
});

test("a stale archive response does not report success or hide the current member", async () => {
  let conflictHandled = false; const messages = []; let cleared = false;
  const archive = teamHandler("updateMemberStatus", {
    busy: "", isCurrentMember: () => false, memberLabel, window: { confirm: () => true },
    setBusy() {}, setError() {}, setMessage: value => messages.push(value), setMenu() { cleared = true; }, setEditing() { cleared = true; },
    tokenHeaders: async () => ({}), fetch: async () => ({ status: 409 }),
    handleMemberConflict: async response => { assert.equal(response.status, 409); conflictHandled = true; return true; },
  });
  await archive(archiveMember, "archived");
  assert.equal(conflictHandled, true);
  assert.equal(cleared, false);
  assert.equal(messages.some(message => /access revoked/.test(message)), false);
});

test("switching between team and archive explicitly resets stale results and filters", () => {
  const changes = {};
  const context = { busy: "", statusFilter: "all" };
  for (const name of ["Loading", "Members", "Page", "Query", "AppliedQuery", "CapabilityFilter", "StatusFilter", "Menu", "InviteUrl", "InviteDelivery", "Error", "Message"]) {
    context[`set${name}`] = value => { changes[name] = value; };
  }
  teamHandler("changeRosterView", context)(true);
  assert.equal(changes.StatusFilter, "archived");
  assert.equal(changes.Loading, true);
  assert.equal(changes.Members.length, 0);
  assert.equal(changes.Page, 1);
  assert.equal(changes.AppliedQuery, "");
  assert.equal(changes.CapabilityFilter, "");
  context.statusFilter = "archived";
  teamHandler("changeRosterView", context)(false);
  assert.equal(changes.StatusFilter, "all");
});

test("archived records cannot issue invitations, PINs, profile edits or document/device mutations", async () => {
  const member = { ...archiveMember, status: "archived" };
  for (const name of ["createLogin", "createFieldPin", "revokeFieldAccess"]) {
    await teamHandler(name, {})(member);
  }
  await teamHandler("updateDevice", {})({ memberStatus: "archived" }, "authorise_device");
  const event = { preventDefault() {}, currentTarget: {} };
  await teamHandler("saveMember", { editing: member })(event);
  await teamHandler("uploadFile", { filesMember: member })(event);
  await teamHandler("deleteFile", { filesMember: member })({ id: "file-1" });
});

// Evaluate the production JSX with plain element nodes. This exercises the same
// branches used on desktop and mobile without network requests or a browser.
const settingsRender = settingsComponent.body.statements.filter(ts.isReturnStatement).at(-1).expression.getText(settingsAst);
const settingsRenderScript = ts.transpileModule(`function renderFixture() { return (${settingsRender}); }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
function renderTeam(overrides = {}) {
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child !== false && child != null) }) },
    styles: new Proxy({}, { get: (_, key) => key }),
    archivedView: false, busy: "", error: "", message: "", editing: null, invitationPanel: null,
    roster: { total: 0, totalPages: 1 }, page: 1, loading: false, query: "", statusFilter: "all", capabilityFilter: "",
    ENERGY_SERVICE_CATALOGUE: [], visibleMembers: [], members: [], isOwner: true,
    memberLabel, isCurrentMember: member => member.id === "self", statusName: member => member.status,
    TradeTeamStatusDot() {}, scheduleColours: [], menu: null, filesMember: null,
    deviceRoster: { total: 0, totalPages: 1 }, devices: [], pendingPushEvents: 0, deviceQuery: "", deviceStatus: "", deviceMemberId: "", devicesLoading: false,
    openNew() {}, searchMembers() {}, closeMemberDialog() {}, dialogRef: {}, filesDialogRef: {}, closeFiles() {},
    filesLoading: false, files: [], preview: null, bytesLabel: value => `${value} bytes`,
    ...overrides,
  };
  return runInNewContext(`${settingsRenderScript}; renderFixture()`, context);
}
function elements(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...node.children.flatMap(elements)];
}
function textContent(node) {
  if (node == null) return "";
  return typeof node === "object" ? node.children.map(textContent).join("") : String(node);
}

test("desktop and mobile show Delete for ordinary staff and never for the owner, current user or archived staff", () => {
  for (const member of [archiveMember, { ...archiveMember, status: "suspended" }, { ...archiveMember, isOwner: true }, { ...archiveMember, id: "self" }, { ...archiveMember, status: "archived" }]) {
    const calls = [];
    const tree = renderTeam({ visibleMembers: [member], updateMemberStatus: (person, state) => calls.push([person.id, state]) });
    const buttons = elements(tree).filter(node => node.type === "button" && textContent(node) === "Delete");
    const expected = !member.isOwner && member.id !== "self" && member.status !== "archived" ? 2 : 0;
    assert.equal(buttons.length, expected);
    for (const button of buttons) button.props.onClick();
    assert.deepEqual(calls, Array.from({ length: expected }, () => [member.id, "archived"]));
  }
});

test("archived details keep identity and documents read-only until access is explicitly reinstated", () => {
  const member = { ...archiveMember, status: "archived" };
  const opened = []; const selected = [];
  const tree = renderTeam({ archivedView: true, statusFilter: "archived", editing: member, visibleMembers: [member], openFiles: person => opened.push(person.id), setEditing: value => selected.push(value) });
  const nodes = elements(tree);
  const dialog = nodes.find(node => node.props.role === "dialog");
  assert.match(textContent(dialog), /Katja Rosic.*katja@example.test.*0400000000/);
  assert.match(textContent(dialog), /read-only/);
  assert.equal(elements(dialog).some(node => ["form", "input", "select"].includes(node.type)), false);
  assert.doesNotMatch(textContent(tree), /Add team member|Re-invite|Reactivate access|Generate and email PIN|Authorise again|Delete/);
  elements(dialog).find(node => node.type === "button" && textContent(node) === "Open documents").props.onClick();
  assert.deepEqual(selected, [null]);
  assert.deepEqual(opened, ["staff-1"]);
});

test("Reinstate access sends an exact restore request with saved revision and never sends an automatic invitation", async () => {
  for (const { hasLogin, defaultView } of [{ hasLogin: false, defaultView: false }, { hasLogin: true, defaultView: true }]) {
    const member = { ...archiveMember, status: "archived", hasLogin };
    const before = JSON.stringify(member);
    const requests = []; const confirmations = []; const messages = []; const refreshes = []; const busy = []; const changes = {};
    const rosterSetters = Object.fromEntries(["Page", "Query", "AppliedQuery", "CapabilityFilter", "StatusFilter", "Members", "Loading"].map(name => [`set${name}`, value => { changes[name] = value; }]));
    const restore = teamHandler("updateMemberStatus", {
      busy: "", isCurrentMember: () => false, memberLabel,
      statusFilter: defaultView ? "all" : "archived", page: defaultView ? 1 : 3, appliedQuery: defaultView ? "" : "Katja", capabilityFilter: defaultView ? "" : "solar", ...rosterSetters,
      window: { confirm: text => { confirmations.push(text); return true; } },
      setBusy: value => busy.push(value), setError() {}, setMessage: value => messages.push(value), setMenu() {}, setEditing() {},
      tokenHeaders: async () => ({ Authorization: "Bearer fixture" }),
      fetch: async (url, options) => { requests.push({ url, method: options.method, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; },
      handleMemberConflict: async () => false,
      load: async () => refreshes.push("roster"), loadDevices: async () => refreshes.push("devices"),
    });
    await restore(member, "active");
    assert.deepEqual(requests, [{ url: "/api/trade-team", method: "PATCH", body: { action: "restore_member", memberId: "staff-1", expectedUpdatedAt: "loaded-revision" } }]);
    assert.match(confirmations[0], /Reinstate access for Katja Rosic.*saved permissions.*device authorisations, PINs and invitation links will stay revoked.*No invitation will be sent automatically/);
    assert.deepEqual(refreshes, defaultView ? ["roster", "devices"] : ["devices"], "the new default-view effect reloads the roster instead of refetching archived records");
    assert.equal(changes.StatusFilter, "all"); assert.equal(changes.Page, 1);
    assert.equal(changes.Query, ""); assert.equal(changes.AppliedQuery, ""); assert.equal(changes.CapabilityFilter, "");
    if (defaultView) assert.equal(changes.Loading, undefined, "an unchanged view reloads directly without leaving a pending loading state");
    else { assert.equal(changes.Loading, true); assert.equal(changes.Members.length, 0); }
    assert.deepEqual(busy, ["status:staff-1", ""]);
    assert.match(messages.at(-1), /Access reinstated for Katja Rosic.*Your team.*Previous device authorisations, PINs and invitations remain revoked.*fresh app setup or invitation.*No invitation was sent automatically/);
    assert.doesNotMatch(messages.at(-1), /must sign in again/);
    assert.equal(JSON.stringify(member), before, "restoration does not rewrite the loaded identity, permissions or document state");
  }
});

test("reinstate confirmation, owner, self, pending mutation and archived transition guards cannot be bypassed", async () => {
  for (const fixture of [
    { member: { ...archiveMember, status: "archived" }, confirmed: false, next: "active" },
    { member: { ...archiveMember, status: "archived", isOwner: true }, next: "active" },
    { member: { ...archiveMember, status: "archived" }, current: true, next: "active" },
    { member: { ...archiveMember, status: "archived" }, busy: "member", next: "active" },
    { member: { ...archiveMember, status: "archived" }, next: "suspended" },
    { member: archiveMember, next: "active" },
  ]) {
    const restore = teamHandler("updateMemberStatus", {
      busy: fixture.busy || "", isCurrentMember: () => fixture.current || false, memberLabel,
      window: { confirm: () => fixture.confirmed ?? true },
    });
    await restore(fixture.member, fixture.next);
  }
});

test("failed or stale reinstatement leaves records archived without reporting success", async () => {
  for (const stale of [false, true]) {
    const messages = []; const errors = []; const busy = []; let closed = false; let refreshed = false;
    const restore = teamHandler("updateMemberStatus", {
      busy: "", isCurrentMember: () => false, memberLabel, window: { confirm: () => true },
      setBusy: value => busy.push(value), setError: value => errors.push(value), setMessage: value => messages.push(value),
      setMenu() { closed = true; }, setEditing() { closed = true; },
      tokenHeaders: async () => ({}),
      fetch: async () => ({ ok: false, status: stale ? 409 : 403, json: async () => ({ error: "Your permission to manage this team changed." }) }),
      handleMemberConflict: async response => { assert.equal(response.status, stale ? 409 : 403); return stale; },
      load: async () => { refreshed = true; }, loadDevices: async () => { refreshed = true; },
    });
    await restore({ ...archiveMember, status: "archived" }, "active");
    assert.equal(messages.some(message => message.startsWith("Access reinstated")), false);
    assert.equal(closed, false); assert.equal(refreshed, false);
    assert.equal(busy.at(-1), "");
    if (!stale) assert.equal(errors.at(-1), "Your permission to manage this team changed.");
  }
});

test("suspended Reactivate access retains its existing update action", async () => {
  const requests = [];
  const reactivate = teamHandler("updateMemberStatus", {
    busy: "", isCurrentMember: () => false, memberLabel, window: { confirm: () => true },
    setBusy() {}, setError() {}, setMessage() {}, setMenu() {}, setEditing() {},
    tokenHeaders: async () => ({}),
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true }) }; },
    handleMemberConflict: async () => false, load: async () => {}, loadDevices: async () => {},
  });
  await reactivate({ ...archiveMember, status: "suspended" }, "active");
  assert.deepEqual(requests, [{ action: "update_member", memberId: "staff-1", status: "active", expectedUpdatedAt: "loaded-revision" }]);
});

test("archived desktop and mobile rows offer Reinstate access beside Open details only for eligible staff", () => {
  for (const member of [{ ...archiveMember, status: "archived" }, { ...archiveMember, status: "archived", isOwner: true }, { ...archiveMember, status: "archived", id: "self" }, archiveMember]) {
    const calls = [];
    const tree = renderTeam({ archivedView: true, visibleMembers: [member], updateMemberStatus: (person, status) => calls.push([person.id, status]) });
    const buttons = elements(tree).filter(node => node.type === "button" && textContent(node) === "Reinstate access");
    const expected = member.status === "archived" && !member.isOwner && member.id !== "self" ? 2 : 0;
    assert.equal(buttons.length, expected);
    for (const button of buttons) {
      const actionGroup = elements(tree).find(node => node.children.includes(button));
      assert.ok(actionGroup.children.some(node => node.type === "button" && textContent(node) === "Open details"));
      button.props.onClick();
    }
    assert.deepEqual(calls, Array.from({ length: expected }, () => [member.id, "active"]));
  }
});

test("archived details expose a confirmed reinstatement action and keep its loading or error state visible", () => {
  const member = { ...archiveMember, status: "archived" }; const calls = [];
  const overrides = { archivedView: true, editing: member, updateMemberStatus: (person, status) => calls.push([person.id, status]) };
  const tree = renderTeam(overrides);
  const dialog = elements(tree).find(node => node.props.role === "dialog");
  elements(dialog).find(node => node.type === "button" && textContent(node) === "Reinstate access").props.onClick();
  assert.deepEqual(calls, [["staff-1", "active"]]);
  const pending = renderTeam({ ...overrides, busy: "status:staff-1", message: "Reinstating team access..." });
  const pendingButton = elements(pending).find(node => node.type === "button" && textContent(node) === "Reinstating...");
  assert.equal(pendingButton.props.disabled, true);
  const failed = renderTeam({ ...overrides, error: "Your permission to manage this team changed." });
  const failedDialog = elements(failed).find(node => node.props.role === "dialog");
  assert.ok(elements(failedDialog).some(node => node.props.role === "alert" && textContent(node) === "Your permission to manage this team changed."));
  assert.equal(elements(failedDialog).some(node => ["form", "input", "select"].includes(node.type)), false);
});

test("archived documents keep View and Download while upload and Delete are absent", () => {
  const file = { id: "file-1", memberId: "staff-1", title: "Retained licence", contentType: "application/pdf", category: "licence", sizeBytes: 10 };
  const calls = [];
  const tree = renderTeam({ archivedView: true, filesMember: { ...archiveMember, status: "archived" }, files: [file], fetchFile: (record, download = false) => calls.push([record.id, download]) });
  const dialog = elements(tree).find(node => node.props["aria-labelledby"] === "member-files-title");
  assert.match(textContent(dialog), /read-only/);
  assert.equal(elements(dialog).some(node => node.type === "form"), false);
  const actions = elements(dialog).filter(node => node.type === "button" && ["View", "Download", "Delete"].includes(textContent(node)));
  assert.deepEqual(actions.map(textContent), ["View", "Download"]);
  actions.forEach(button => button.props.onClick());
  assert.deepEqual(calls, [["file-1", false], ["file-1", true]]);
});
