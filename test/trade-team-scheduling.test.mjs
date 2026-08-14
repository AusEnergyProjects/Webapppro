import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { addCalendarDays, appointmentDurationMinutes, appointmentEndsAt, assertFutureAppointment, defaultWorkingWindow, durationLabel, insideWorkingWindow, moveAppointmentToDate, normaliseAppointmentDuration, normaliseScheduleRangeWeeks, normaliseWeekStart, rangesOverlap, scheduleAppointmentLanes, scheduleConflictIds, scheduleDisplayWindow } from "../src/lib/trade-schedule.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0051_team_scheduling_capacity.sql");
const route = read("../src/app/api/trade-schedule/route.ts");
const scheduleServer = read("../src/lib/trade-schedule-server.ts");
const ui = read("../src/components/TradeScheduleWorkspace.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const teamPortal = read("../src/components/TradeTeamPortal.tsx");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const adminRoute = read("../src/app/api/admin/accounts/route.ts");
const adminUi = read("../src/components/AdminAccountWorkspace.tsx");
const apply = (db, sql) => { for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement); };

test("the exact reviewed ABN projection is authoritative in admin and signed-in account responses", () => {
  assert.match(profileRoute, /approvedAbnAccess\(\{/);
  assert.match(profileRoute, /verifiedAbn: String\(record\.verified_abn/);
  assert.match(profileRoute, /verificationReviewedAt: String\(record\.verification_reviewed_at/);
  assert.match(profileRoute, /verificationReviewedByUid: String\(record\.verification_reviewed_by_uid/);
  assert.match(adminRoute, /accessApproved: approvedAbnAccess\(account\)/);
  assert.match(adminUi, /Approved ABN access/);
  assert.match(adminUi, /No approved review is recorded/);
});

test("week and capacity calculations are deterministic", () => {
  assert.equal(normaliseWeekStart("2026-07-13"), "2026-07-13");
  assert.equal(addCalendarDays("2026-07-13", 7), "2026-07-20");
  assert.throws(() => normaliseWeekStart("2026-07-14"), /INVALID_WEEK/);
  assert.equal(rangesOverlap("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-13T09:30", "2026-07-13T11:00"), true);
  assert.equal(rangesOverlap("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-13T10:00", "2026-07-13T11:00"), false);
  assert.equal(insideWorkingWindow("2026-07-13T09:00", "2026-07-13T17:00", defaultWorkingWindow(1)), true);
  assert.equal(insideWorkingWindow("2026-07-13T08:59", "2026-07-13T10:00", defaultWorkingWindow(1)), false);
  assert.equal(assertFutureAppointment("2026-07-19T09:01", "2026-07-19T09:00"), "2026-07-19T09:01");
  assert.throws(() => assertFutureAppointment("2026-07-19T09:00", "2026-07-19T09:00"), /PAST_APPOINTMENT/);
  assert.deepEqual(moveAppointmentToDate("2026-07-13T09:00", "2026-07-13T10:30", "2026-07-19", "2026-07-18T12:00"), { startsAt: "2026-07-19T09:00", endsAt: "2026-07-19T10:30" });
  assert.deepEqual(moveAppointmentToDate("2026-07-13T09:00", "2026-07-13T10:00", "2026-07-19", "2026-07-19T09:07"), { startsAt: "2026-07-19T09:15", endsAt: "2026-07-19T10:15" });
  assert.equal(appointmentEndsAt("2026-07-19T09:00", 30), "2026-07-19T09:30");
  assert.equal(appointmentDurationMinutes("2026-07-19T09:00", "2026-07-19T17:00"), 480);
  assert.equal(durationLabel(75), "1h 15m");
  assert.equal(normaliseScheduleRangeWeeks(undefined), 1);
  assert.equal(normaliseScheduleRangeWeeks("8"), 8);
  assert.throws(() => normaliseScheduleRangeWeeks(0), /INVALID_SCHEDULE_RANGE/);
  assert.throws(() => normaliseScheduleRangeWeeks(9), /INVALID_SCHEDULE_RANGE/);
  assert.throws(() => normaliseAppointmentDuration(10), /INVALID_DURATION/);
  assert.throws(() => normaliseAppointmentDuration(495), /INVALID_DURATION/);
});

test("overlapping appointments receive separate visible lanes", () => {
  const layout = scheduleAppointmentLanes([
    { id: "a", startsAt: "2026-07-20T09:00", endsAt: "2026-07-20T10:30" },
    { id: "b", startsAt: "2026-07-20T09:15", endsAt: "2026-07-20T10:00" },
    { id: "c", startsAt: "2026-07-20T10:00", endsAt: "2026-07-20T11:00" },
    { id: "d", startsAt: "2026-07-20T11:00", endsAt: "" },
  ]);
  assert.deepEqual(layout.get("a"), { lane: 0, laneCount: 2 });
  assert.deepEqual(layout.get("b"), { lane: 1, laneCount: 2 });
  assert.deepEqual(layout.get("c"), { lane: 1, laneCount: 2 });
  assert.deepEqual(layout.get("d"), { lane: 0, laneCount: 1 });
});

test("the rolling schedule derives conflicts and a compact visible workday", () => {
  assert.deepEqual([...scheduleConflictIds([
    { id: "a", assigneeMemberId: "one", startsAt: "2026-07-20T09:00", endsAt: "2026-07-20T10:30" },
    { id: "b", assigneeMemberId: "one", startsAt: "2026-07-20T09:15", endsAt: "2026-07-20T10:00" },
    { id: "c", assigneeMemberId: "one", startsAt: "2026-07-20T11:00", endsAt: "2026-07-20T12:00" },
    { id: "d", assigneeMemberId: "two", startsAt: "2026-07-20T09:15", endsAt: "2026-07-20T10:00" },
  ])].sort(), ["a", "b"]);
  assert.deepEqual(scheduleDisplayWindow([]), { startMinute: 420, endMinute: 1140 });
  assert.deepEqual(scheduleDisplayWindow([
    { id: "early", startsAt: "2026-07-20T05:30", endsAt: "2026-07-20T06:30" },
    { id: "late", startsAt: "2026-07-20T19:15", endsAt: "2026-07-20T21:15" },
  ]), { startMinute: 300, endMinute: 1320 });
});

test("the additive migration extends existing team and appointment sources", () => {
  for (const table of ["trade_team_working_hours", "trade_team_unavailability"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /ALTER TABLE `trade_crm_appointments` ADD `assignee_member_id`/);
  assert.match(migration, /ALTER TABLE `trade_crm_appointments` ADD `revision`/);
  assert.match(migration, /trade_crm_appointments_assignee_start_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE `trade_work_orders`|CREATE TABLE `trade_crm_appointments`/);
});

test("the scheduling migration applies cleanly to its appointment dependency", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_crm_appointments (id text PRIMARY KEY NOT NULL, firebase_uid text NOT NULL, status text NOT NULL, starts_at text NOT NULL)");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["trade_crm_appointments", "trade_team_unavailability", "trade_team_working_hours"]);
  const columns = db.prepare("PRAGMA table_info(trade_crm_appointments)").all().map((row) => row.name);
  assert.ok(columns.includes("assignee_member_id")); assert.ok(columns.includes("revision"));
});

test("schedule SQL compiles against the production team and CRM migrations", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0011_even_reavers.sql", "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0025_dizzy_spot.sql", "0026_lovely_zodiak.sql", "0047_customer_service_site_foundation.sql", "0051_team_scheduling_capacity.sql", "0055_appointment_rescheduling.sql", "0057_customer_property_arrivals.sql", "0058_trade_contact_arrival_handoff.sql", "0070_frictionless_team_roster.sql", "0116_trade_crm_write_guard.sql", "0131_trade_team_permissions_and_member_files.sql", "0134_team_member_documents_and_colours.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  const queries = [route, scheduleServer].flatMap((source) => [...source.matchAll(/prepare\(\s*`([\s\S]*?)`,?\s*\)/g)].map((match) => match[1])).filter((sql) => !sql.includes("${"));
  assert.ok(queries.length > 10);
  for (const sql of queries) assert.doesNotThrow(() => db.prepare(sql), `schedule SQL should compile: ${sql.slice(0, 80)}`);
});

test("authorised schedule scopes receive server-enforced conflict and revision checks", () => {
  for (const boundary of ["requireInstallerTeamAccess", "sameOrigin", "canViewSchedule", "canRescheduleWithinScope", "canAssignJob", "activeMember", "owner_uid = ?", "firebase_uid = ?"]) assert.match(route, new RegExp(boundary));
  assert.doesNotMatch(route, /access\.role|canDispatch\(access\)/);
  for (const conflict of ["REVISION_CONFLICT", "APPOINTMENT_CONFLICT", "UNAVAILABLE_CONFLICT", "PAST_APPOINTMENT"]) assert.match(`${route}\n${scheduleServer}`, new RegExp(conflict));
  assert.doesNotMatch(`${route}\n${scheduleServer}`, /throw new Error\("WORKING_HOURS_CONFLICT"\)/);
  assert.match(scheduleServer, /status IN \('scheduled', 'en_route', 'arrived', 'in_progress'\) \$\{exclusionSql\}/);
  assert.match(route, /assertTradeScheduleAvailable\(\{ ownerUid: access\.ownerUid, memberId, startsAt, endsAt/);
  assert.match(route, /ON CONFLICT\(owner_uid, team_member_id, weekday\) DO UPDATE/);
  assert.match(route, /schedule_updated/); assert.match(route, /schedule_created/); assert.match(route, /jobSyncChangeStatements/);
});

test("several staged moves are validated and committed as one guarded schedule batch", () => {
  const batch = route.match(/else if \(action === "save_schedule_changes"\)[\s\S]*?(?=\n\s*} else if \(action === "schedule_appointment"\))/)?.[0] || "";
  assert.match(batch, /body\.changes\.length < 1 \|\| body\.changes\.length > 5/);
  assert.match(batch, /new Set\(appointmentIds\)\.size !== appointmentIds\.length/);
  assert.match(batch, /currentRows\.results\.length !== changes\.length/);
  assert.match(batch, /new Set\(workOrderIds\)\.size !== workOrderIds\.length/);
  assert.match(batch, /change\.expectedRevision !== Number\(current\.revision\)/);
  assert.match(batch, /assertCurrentScheduleAssignment\(access/);
  assert.match(batch, /assertScheduleTarget\(access, change\.memberId\)/);
  assert.match(batch, /assertAssignmentChange\(access/);
  assert.match(batch, /assertMemberCapability\(member/);
  assert.match(batch, /assertTradeJobReadyForScheduling\(access\.ownerUid/);
  assert.match(batch, /left\.memberId === right\.memberId && left\.startsAt < right\.endsAt && left\.endsAt > right\.startsAt/);
  assert.match(batch, /excludeAppointmentIds: appointmentIds/);
  assert.match(batch, /status = 'scheduled' AND revision = \? AND assignee_member_id = \?/);
  assert.match(batch, /previousTradeScheduleMutationGuardStatement/);
  assert.match(batch, /tradeJobScheduleEligibilityGuardStatement/);
  assert.match(batch, /tradeScheduleAvailabilityGuardStatement/);
  assert.match(batch, /plannedComplianceIntentReplanStatements/);
  assert.match(batch, /jobSyncChangeStatements/);
  assert.match(batch, /await db\.batch\(statements\)/);
  assert.equal((batch.match(/await db\.batch\(/g) || []).length, 1);
  assert.match(batch, /notifications\.push\(\{/);
  assert.match(batch, /syncAppointmentIds\.push\(item\.appointmentId\)/);
  assert.match(scheduleServer, /excludeAppointmentIds\?\.length/);
  assert.match(scheduleServer, /excludedIds\.map\(\(\) => "\?"\)\.join\(", "\)/);
});

test("schedule payloads preserve customer privacy boundaries", () => {
  assert.match(route, /protectedJob =\s*row\.source_type === "opportunity" \|\|\s*row\.customer_source === "platform_private"/);
  assert.match(route, /LEFT JOIN trade_crm_customers c ON c\.id = d\.crm_customer_id AND c\.firebase_uid = w\.firebase_uid AND c\.record_status = 'active'/);
  assert.match(route, /protectedJob \? "Australian Energy Assessments protected customer"/);
  assert.match(route, /protectedJob\s*\?\s*row\.site_area \|\| "Protected service region"/);
  assert.match(route, /customer_business_name/);
  assert.match(route, /customer_first_name, row\.customer_last_name/);
  assert.match(route, /c\.email customer_email, c\.phone customer_phone/);
  assert.match(route, /s\.address_line_1, s\.address_line_2, s\.suburb, s\.address_state, s\.postcode/);
  assert.match(route, /const canSeeOperationalDetails = !protectedJob/);
  assert.match(route, /const canSeeCustomerContact = !protectedJob/);
  for (const field of ["addressLine1", "addressLine2", "addressSuburb", "addressState", "addressPostcode"]) {
    assert.match(route, new RegExp(`${field}: canSeeOperationalDetails`));
  }
  assert.match(route, /notes: canSeeOperationalDetails/);
  assert.match(route, /customerEmail: canSeeCustomerContact/);
  assert.match(route, /customerPhone: canSeeCustomerContact/);
  assert.match(route, /tradeJobScheduleEligibilitySql\("w", "d"\)/);
  assert.match(route, /assertTradeJobReadyForScheduling\(access\.ownerUid, workOrderId\)/);
  assert.match(scheduleServer, /schedule_version\.version_number = schedule_quote\.current_version_number/);
  assert.match(scheduleServer, /schedule_acceptance\.quote_version_id = schedule_version\.id/);
  assert.match(scheduleServer, /schedule_acceptance\.decision = 'accepted'/);
  assert.match(scheduleServer, /tradeJobScheduleEligibilityGuardStatement/);
});

test("appointments expose compact quote state without bypassing the existing quote workspace", () => {
  assert.match(route, /d\.quote_status, d\.quoted_value_cents/);
  assert.match(route, /quoteStatus: access\.canViewQuotes \? String\(row\.quote_status \|\| "not_started"\) : "restricted"/);
  assert.match(route, /quotedValueCents: access\.canViewQuotes \? Number\(row\.quoted_value_cents \|\| 0\) : 0/);
  assert.match(ui, /onOpenQuote\?: \(workOrderId: string\) => void/);
  assert.match(ui, /className="schedule-quote-summary"/);
  assert.match(ui, /readable\(selectedAppointment\.quoteStatus \|\| "not_started"\)/);
  assert.match(ui, /money\(selectedAppointment\.quotedValueCents \|\| 0\)/);
  assert.match(ui, /onOpenQuote && !selectedAppointment\.protectedJob/);
  assert.match(ui, />Open quote<\/button>/);
  assert.match(crm, /onOpenQuote=\{\(!staffPermissions \|\| staffPermissions\.canViewQuotes\) \? \(id\) => openFocusedJob\(id, "quote"\) : undefined\}/);
  assert.doesNotMatch(teamPortal, /onOpenQuote=/);
});

test("the installer dashboard exposes stable one-week scheduling with adjacent drag buffering", () => {
  for (const copy of ["One clear week at a time", "Go to week", "Previous week", "Next week", "Today", "Swipe to change week", "Hold for previous week", "Hold for next week", "Add to schedule", "Conflicts only", "Set working hours and time off", "minuteFromPointer", "moveAppointmentToDate", "outsideWorkingHours", "memberLabel", "ownerMemberId", "schedule_appointment", "schedule_job", "save_schedule_changes", "Save schedule changes", "Discard"]) assert.match(ui, new RegExp(copy));
  assert.match(ui, /const calendarCanReschedule = canRescheduleJobs/);
  assert.match(ui, /draggable=\{calendarCanReschedule && !busy && !loading\}/);
  assert.match(ui, /const SCHEDULE_BUFFER_WEEKS = 3/);
  assert.match(ui, /const days = scheduleWeekDays\(bufferedWeekStart\)/);
  assert.match(ui, /appointmentsByDate = useMemo/);
  assert.match(ui, /const laneItems = \[\.\.\.dayAppointments, \.\.\.dayUnavailability, \.\.\.\(proposalOnDay \? \[proposalOnDay\] : \[\]\)\]/);
  assert.match(ui, /scheduleAppointmentLanes\(laneItems\)/);
  assert.match(ui, /new AbortController\(\)/);
  assert.match(ui, /schedule-dialog-status/);
  assert.match(ui, /className="schedule-week-pages" style=\{\{ transform: `translateX/);
  assert.match(ui, /autoScrollDuringDrag\(event\.clientX, event\.clientY\)/);
  assert.match(ui, /draggedAppointmentRef\.current = item/);
  assert.match(ui, /dragEdgeTimerRef\.current = window\.setTimeout/);
  assert.match(ui, /dragDropCommittedRef\.current = true/);
  assert.match(ui, /pendingDragScrollPositionRef\.current = \{/);
  assert.match(ui, /minute: gridStartMinute \+ \(\(container\?\.scrollTop \|\| 0\) \/ GRID_QUARTER_HEIGHT\) \* 15/);
  assert.match(ui, /container\.scrollTop = Math\.max\(0, \(\(position\.minute - gridStartMinute\)/);
  assert.match(ui, /pendingWeekStartRef\.current = targetWeek/);
  assert.match(ui, /setFailedWeekStart\(pendingWeekStartRef\.current\)/);
  assert.match(ui, /setFailedWeekStart\(""\)/);
  assert.match(ui, /targetRangeStart === rangeStart\) setLoadAttemptNonce/);
  assert.match(ui, /const saved = await update\(\{ action: "save_schedule_changes", changes \}/);
  assert.match(ui, /if \(!saved\) return/);
  assert.match(ui, /setActiveWeekStart\(sourceWeek\)/);
  assert.match(ui, /applyScheduleChangeDrafts\(scheduleChangeSources, scheduleChangeDrafts\)/);
  assert.match(ui, /stageScheduleChange\(appointment, date/);
  assert.match(ui, /function discardScheduleChanges\(\)[\s\S]*?setPendingScheduleChanges\(\{\}\)/);
  assert.match(ui, /scheduleWeekSwipeDirection/);
  assert.match(ui, /className="schedule-week-viewport" onTouchStart=\{startWeekSwipe\} onTouchEnd=\{\(event\) => finishWeekSwipe\(event, true\)\} onTouchCancel=/);
  assert.doesNotMatch(ui, /handleScheduleScroll|rollScheduleWindow|eight weeks together|calendar rolls as you scroll/);
  assert.match(ui, /initialWeekStart\?: string/);
  assert.match(ui, /className="schedule-today-strip"/);
  assert.match(ui, /const todayInRange = todayDate >= activeWeekStart/);
  assert.match(ui, /if \(body\.action === "schedule_appointment"\) closeAppointment\(\);/);
  assert.match(ui, /Load today's work/);
  assert.match(ui, /Outside this week/);
  assert.match(ui, /aria-current=\{dayIsToday \? "date" : undefined\}/);
  assert.match(ui, /className="schedule-now-line"/);
  assert.match(ui, /scheduleDisplayWindow\(activeWeekDisplayAppointments\)/);
  assert.match(ui, /expectedRevision: change\.appointment\.revision/);
  assert.match(route, /scheduleConflictIds\(/);
  assert.match(ui, /min=\{minimumStart\}/);
  assert.match(route, /member_uid === ownerUid/);
  assert.match(route, /normaliseScheduleRangeWeeks\(search\.get\("rangeWeeks"\), 1\)/);
  assert.match(route, /schedulePayload\(access, rangeStart, rangeWeeks\)/);
  assert.match(route, /for \(const appointmentId of Array\.from\(new Set\(syncAppointmentIds\)\)\)/);
  assert.match(route, /syncCreatedAppointmentToConnectedCalendars\(access\.ownerUid, appointmentId, \{ force: true \}\)/);
  assert.doesNotMatch(dashboard, /workspace === "schedule"/);
  assert.match(dashboard, /kind: "crm-view", id: "schedule"/);
  assert.match(dashboard, /hasBusinessOperations && hasTeamAccess/);
  assert.doesNotMatch(teamPortal, /TradeScheduleWorkspace|canDispatch/);
});

test("job-focused scheduling keeps the permission-aware week and hides unrelated dispatch panels", () => {
  assert.match(ui, /variant\?: "full" \| "job"/);
  assert.match(ui, /const jobCalendar = variant === "job"/);
  assert.match(ui, /scheduleScope === "own" \? "Your calendar" : "Team calendar"/);
  assert.match(ui, /Check the week before you book/);
  assert.match(ui, /proposalConflictIds/);
  assert.match(ui, /const proposalValidation = useMemo\(\(\) => scheduleProposalValidation/);
  assert.match(ui, /const proposalHasConflict = proposalValidation\.conflict/);
  assert.match(ui, /schedulePermissions\?\.scheduleScope === "own"/);
  assert.match(ui, /role=\{jobCalendar \? "status" : undefined\}/);
  assert.match(ui, /aria-live=\{jobCalendar \? "polite" : undefined\}/);
  assert.match(ui, /proposalValidation\.status === "load_error"/);
  assert.match(ui, /loadFailed: Boolean\(loadError\)/);
  assert.match(ui, /setLoadError\(""\)/);
  assert.match(ui, /Retry calendar/);
  assert.match(ui, /setLoadAttemptNonce\(\(value\) => value \+ 1\)/);
  assert.match(ui, /useState\(\(\) => jobCalendar \? focusedMemberId \|\| proposal\?\.assigneeMemberId \|\| "" : ""\)/);
  assert.match(ui, /setMemberFilter\(focusedMemberId \|\| ""\)/);
  assert.match(ui, /jobCalendar && \(members\.length > 1 \|\| Boolean\(memberFilter && !members\.some/);
  assert.match(ui, /<option value="">All workers<\/option>/);
  assert.match(ui, /invalidateScheduleProposal\(proposalValidation\.key\)/);
  assert.match(ui, /scheduleMemberLabel\(member, data\.access\?\.memberId \|\| ""\)/);
  assert.match(ui, /className="schedule-block unavailable"/);
  assert.match(ui, />Unavailable<\/strong>/);
  assert.doesNotMatch(ui, /schedule-block unavailable[\s\S]{0,500}item\.reason/);
  assert.match(ui, /Proposed booking/);
  assert.match(ui, /\{!jobCalendar && <section className="schedule-today-strip"/);
  assert.match(ui, /\{!jobCalendar && <details className="schedule-filter-panel"/);
  assert.match(ui, /\{!jobCalendar && \(data\.rescheduleRequests \|\| \[\]\)\.length > 0/);
  assert.match(ui, /\{draggingId &&/);
  assert.match(ui, /\{!jobCalendar && <details className="schedule-capacity"/);
  assert.match(ui, /\{!jobCalendar && !permissions && <details className="schedule-calendar-links"/);
  assert.match(ui, /\{!jobCalendar && \(canRescheduleJobs \|\| canManageAvailability\) && <div className="schedule-lower-grid"/);
});

test("appointment cards prioritise field-use context and open an accessible editor", () => {
  assert.match(ui, /<strong>\{item\.customerDisplayName\}<\/strong><small>\{item\.assigneeLabel \|\| "Unassigned"\}<\/small><em>\{item\.suburbLabel\}<\/em><span>\{formatTime\(item\.startsAt\)\}/);
  assert.doesNotMatch(ui, /<strong>\{item\.workNumber\}<\/strong>/);
  assert.match(ui, /role="button" aria-label=\{`View appointment for \$\{cardLabel\}`\}/);
  assert.match(ui, /role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title"/);
  assert.match(ui, /document\.body\.style\.overflow = "hidden"/);
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /event\.key === "Escape"\)[\s\S]*setSelectedAppointmentId\(""\)[\s\S]*delete next\[selectedAppointmentId\]/);
  assert.match(ui, /event\.key !== "Tab" \|\| !appointmentDialogRef\.current/);
  assert.match(ui, /querySelectorAll<HTMLElement>\("button:not\(\[disabled\]\), input:not\(\[disabled\]\), select:not\(\[disabled\]\), textarea:not\(\[disabled\]\), a\[href\]"/);
  assert.match(ui, /event\.shiftKey && document\.activeElement === first[\s\S]*?last\.focus\(\)/);
  assert.match(ui, /!event\.shiftKey && document\.activeElement === last[\s\S]*?first\.focus\(\)/);
  assert.match(ui, /selectedTriggerRef\.current\?\.focus\(\)/);
  assert.match(ui, /event\.currentTarget === event\.target\) closeAppointment\(\)/);
  assert.match(ui, /aria-label="Close appointment details"/);
  assert.match(ui, /function appointmentSiteAddress\(appointment: Appointment\)/);
  assert.match(ui, /appointment\.siteAddress \|\| \[appointment\.addressLine1, appointment\.addressLine2, appointment\.addressSuburb, appointment\.addressState, appointment\.addressPostcode\]/);
  assert.match(ui, /const siteAddress = appointmentSiteAddress\(selectedAppointment\)/);
  assert.match(ui, /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.match(ui, /target="_blank" rel="noreferrer">Open directions<\/a>/);
  assert.match(ui, /selectedAppointment\.customerPhone/);
  assert.match(ui, /selectedAppointment\.customerEmail/);
  assert.match(ui, /selectedAppointment\.notes/);
  assert.match(ui, /type="date" min=\{minimumStart\.slice\(0, 10\)\}/);
  assert.match(ui, /<DurationControl id=\{`appointment-duration-/);
  assert.match(ui, /stageScheduleChange\(selectedAppointment, edit\.date, minuteValue\(edit\.time\), edit\.memberId, edit\.durationMinutes\)/);
  assert.match(ui, />Stage schedule change<\/button>/);
  assert.doesNotMatch(ui, /onClick=\{\(\) => void update\(\{ action: "schedule_appointment", appointmentId: selectedAppointment\.id/);
});

test("new scheduling and authority copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(`${route}\n${ui}\n${adminUi}`, /[\u2013\u2014]/);
});
