import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adjacentScheduleWeek,
  applyScheduleChangeDrafts,
  invalidateScheduleProposal,
  scheduleChangeConflictIds,
  scheduleDragEdgeDirection,
  scheduleMemberLabel,
  scheduleMinuteFromGridPosition,
  scheduleProposalKey,
  scheduleProposalDurationFromEndMinute,
  scheduleProposalValidation,
  scheduleRangeContainsWeek,
  scheduleWeekDays,
  scheduleWeekSwipeDirection,
} from "../src/lib/trade-schedule.ts";

const scheduleUi = fs.readFileSync(new URL("../src/components/TradeScheduleWorkspace.tsx", import.meta.url), "utf8");
const scheduleStyles = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("schedule navigation exposes one exact Monday to Sunday week", () => {
  assert.deepEqual(scheduleWeekDays("2026-07-20"), [
    "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25", "2026-07-26",
  ]);
  assert.equal(adjacentScheduleWeek("2026-07-20", -1), "2026-07-13");
  assert.equal(adjacentScheduleWeek("2026-07-20", 1), "2026-07-27");
  assert.equal(scheduleRangeContainsWeek("2026-07-13", 3, "2026-07-13"), true);
  assert.equal(scheduleRangeContainsWeek("2026-07-13", 3, "2026-07-20"), true);
  assert.equal(scheduleRangeContainsWeek("2026-07-13", 3, "2026-07-27"), true);
  assert.equal(scheduleRangeContainsWeek("2026-07-13", 3, "2026-08-03"), false);
});

test("week navigation has no fixed far-future horizon", () => {
  const origin = "2026-07-20";
  let week = origin;
  for (let index = 0; index < 1040; index += 1) week = adjacentScheduleWeek(week, 1);
  assert.equal(week, "2046-06-25");
  assert.deepEqual(scheduleWeekDays(week), [
    "2046-06-25", "2046-06-26", "2046-06-27", "2046-06-28", "2046-06-29", "2046-06-30", "2046-07-01",
  ]);
  assert.equal(scheduleRangeContainsWeek(adjacentScheduleWeek(week, -1), 3, week), true);
  for (let index = 0; index < 1040; index += 1) week = adjacentScheduleWeek(week, -1);
  assert.equal(week, origin);
});

test("a job proposal can only be submitted when its visible loaded week is conflict free", () => {
  const base = {
    startsAt: "2026-07-22T10:00",
    endsAt: "2026-07-22T11:00",
    assigneeMemberId: "member-1",
    activeWeekStart: "2026-07-20",
    loadedRangeStart: "2026-07-13",
    loadedRangeWeeks: 3,
  };
  assert.deepEqual(scheduleProposalValidation({ ...base, loading: true }), {
    key: scheduleProposalKey(base.startsAt, 60, base.assigneeMemberId), status: "loading", conflict: false,
  });
  assert.equal(scheduleProposalValidation({ ...base, startsAt: "2046-06-27T10:00", endsAt: "2046-06-27T11:00", loadFailed: true }).status, "load_error");
  assert.equal(scheduleProposalValidation({ ...base, startsAt: "2046-06-27T10:00", endsAt: "2046-06-27T11:00", failedWeekStart: "2046-06-25" }).status, "load_error");
  assert.equal(scheduleProposalValidation({ ...base, activeWeekStart: "2026-07-13" }).status, "not_visible");
  assert.equal(scheduleProposalValidation({ ...base, activeWeekStart: "2046-06-25", loadedRangeStart: "2046-06-18" }).status, "not_visible");
  assert.equal(scheduleProposalValidation({ ...base, visibleMemberId: "member-2" }).status, "not_visible");
  assert.equal(scheduleProposalValidation({ ...base, assigneeActive: false }).status, "assignee_unavailable");
  assert.deepEqual(scheduleProposalValidation({ ...base, appointments: [{ assigneeMemberId: "member-1", startsAt: "2026-07-22T10:30", endsAt: "2026-07-22T11:30" }] }), {
    key: scheduleProposalKey(base.startsAt, 60, base.assigneeMemberId), status: "conflict", conflict: true,
  });
  assert.equal(scheduleProposalValidation({ ...base, appointments: [{ assigneeMemberId: "member-2", startsAt: "2026-07-22T10:30", endsAt: "2026-07-22T11:30" }] }).status, "clear");
  assert.equal(scheduleProposalValidation({ ...base, unavailability: [{ teamMemberId: "member-1", startsAt: "2026-07-22T09:00", endsAt: "2026-07-22T12:00" }] }).status, "unavailable");
  assert.deepEqual(scheduleProposalValidation(base), {
    key: scheduleProposalKey(base.startsAt, 60, base.assigneeMemberId), status: "clear", conflict: false,
  });
});

test("calendar view changes immediately invalidate a previously clear proposal", () => {
  const key = scheduleProposalKey("2026-07-22T10:00", 60, "member-1");
  assert.deepEqual(invalidateScheduleProposal(key), { key, status: "not_visible", conflict: false });
  assert.deepEqual(invalidateScheduleProposal(key, "loading"), { key, status: "loading", conflict: false });
});

test("schedule member labels identify the viewer rather than assuming the owner is me", () => {
  const owner = { id: "owner", displayName: "Alice", isOwner: true };
  const worker = { id: "worker", displayName: "Ben", isOwner: false };
  assert.equal(scheduleMemberLabel(worker, "worker"), "Me");
  assert.equal(scheduleMemberLabel(owner, "worker"), "Alice (owner)");
  assert.equal(scheduleMemberLabel(owner, "owner"), "Me");
});

test("several appointment moves project locally without mutating authoritative schedule data", () => {
  const appointments = [
    { id: "a", assigneeMemberId: "worker-1", startsAt: "2026-07-20T09:00", endsAt: "2026-07-20T10:00" },
    { id: "b", assigneeMemberId: "worker-1", startsAt: "2026-07-20T10:00", endsAt: "2026-07-20T11:00" },
    { id: "c", assigneeMemberId: "worker-2", startsAt: "2026-07-20T09:00", endsAt: "2026-07-20T10:00" },
  ];
  const changes = [
    { appointmentId: "a", memberId: "worker-1", startsAt: "2026-07-21T11:15", durationMinutes: 45 },
    { appointmentId: "b", memberId: "worker-1", startsAt: "2026-07-21T12:00", durationMinutes: 30 },
  ];
  const projected = applyScheduleChangeDrafts(appointments, changes);
  assert.deepEqual(projected, [
    { ...appointments[0], startsAt: "2026-07-21T11:15", endsAt: "2026-07-21T12:00", scheduleDraft: true },
    { ...appointments[1], startsAt: "2026-07-21T12:00", endsAt: "2026-07-21T12:30", scheduleDraft: true },
    { ...appointments[2], scheduleDraft: false },
  ]);
  assert.equal(appointments[0].startsAt, "2026-07-20T09:00");
  assert.deepEqual([...scheduleChangeConflictIds(appointments, changes)], []);

  const sameWorkerOverlap = [{ appointmentId: "b", memberId: "worker-1", startsAt: "2026-07-20T09:30", durationMinutes: 60 }];
  assert.deepEqual([...scheduleChangeConflictIds(appointments, sameWorkerOverlap)].sort(), ["a", "b"]);
  const differentWorkerOverlap = [{ appointmentId: "c", memberId: "worker-2", startsAt: "2026-07-20T10:00", durationMinutes: 60 }];
  assert.deepEqual([...scheduleChangeConflictIds(appointments, differentWorkerOverlap)], []);
});

test("phone week swipes ignore taps, vertical movement and appointment gestures", () => {
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -120, deltaY: 8 }), 1);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: 120, deltaY: 8 }), -1);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: 20, deltaY: 1 }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -100, deltaY: 100 }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -120, deltaY: 8, startedOnAppointment: true }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -120, deltaY: 8, dragActive: true }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -120, deltaY: 8, requireBoundary: true, atEndBoundary: false }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: -120, deltaY: 8, requireBoundary: true, atEndBoundary: true }), 1);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: 120, deltaY: 8, requireBoundary: true, atStartBoundary: false }), 0);
  assert.equal(scheduleWeekSwipeDirection({ deltaX: 120, deltaY: 8, requireBoundary: true, atStartBoundary: true }), -1);
});

test("edge week changes only arm near a boundary during an appointment drag", () => {
  assert.equal(scheduleDragEdgeDirection(20, 0, 1000, true), -1);
  assert.equal(scheduleDragEdgeDirection(980, 0, 1000, true), 1);
  assert.equal(scheduleDragEdgeDirection(500, 0, 1000, true), 0);
  assert.equal(scheduleDragEdgeDirection(20, 0, 1000, false), 0);
  assert.equal(scheduleDragEdgeDirection(980, 0, 1000, false), 0);
});

test("calendar placement and proposal resizing snap to exact 15 minute boundaries", () => {
  assert.equal(scheduleMinuteFromGridPosition(4 * 16, 7 * 60, 19 * 60, 60), 8 * 60);
  assert.equal(scheduleMinuteFromGridPosition(4.6 * 16, 7 * 60, 19 * 60, 60), 8 * 60 + 15);
  assert.equal(scheduleMinuteFromGridPosition(9999, 7 * 60, 19 * 60, 60), 18 * 60);
  assert.equal(scheduleProposalDurationFromEndMinute(11 * 60, 11 * 60 + 44, 19 * 60), 45);
  assert.equal(scheduleProposalDurationFromEndMinute(11 * 60, 12 * 60 + 7, 19 * 60), 60);
  assert.equal(scheduleProposalDurationFromEndMinute(11 * 60, 10 * 60, 19 * 60), 15);
  assert.equal(scheduleProposalDurationFromEndMinute(18 * 60 + 30, 22 * 60, 19 * 60), 30);
});

test("the job calendar exposes guarded pointer and keyboard proposal gestures with aligned controls", () => {
  assert.match(scheduleUi, /onDoubleClick=\{\(event\) => \{ selectProposalFromCalendar/);
  assert.match(scheduleUi, /durationMinutes: 60/);
  assert.match(scheduleUi, /role="slider"[\s\S]*aria-valuemin=\{APPOINTMENT_MIN_DURATION_MINUTES\}/);
  assert.match(scheduleUi, /setPointerCapture\(event\.pointerId\)/);
  assert.match(scheduleUi, /onPointerMove=\{resizeProposalFromPointer\}/);
  assert.match(scheduleUi, /data-schedule-appointment\], \[data-schedule-proposal\]/);
  assert.match(scheduleUi, /event\.key === "ArrowUp"[\s\S]*event\.key === "ArrowDown"/);
  assert.match(scheduleUi, /const height = Math\.max\(16, \(duration \/ 15\) \* GRID_QUARTER_HEIGHT\)/);
  assert.match(scheduleStyles, /\.schedule-week-nav \{ align-items: flex-end;/);
  assert.match(scheduleStyles, /\.schedule-time-track span\.first \{ transform: none; \}/);
  assert.match(scheduleStyles, /\.schedule-time-track span\.last \{ transform: translateY\(-100%\); \}/);
  assert.match(scheduleStyles, /\.schedule-proposal-resize[\s\S]*touch-action: none/);
  assert.match(scheduleStyles, /\.schedule-proposal-resize \{[^}]*height: 32px/);
});

test("whole-card moves remain local until one deliberate schedule save", () => {
  const stage = scheduleUi.match(/function stageScheduleChange\([\s\S]*?(?=\n\s*async function saveScheduleChanges)/)?.[0] || "";
  assert.match(stage, /setPendingScheduleChanges\(\(current\) =>/);
  assert.doesNotMatch(stage, /fetch\(|\bupdate\(/);
  assert.match(stage, /scheduleRangeContainsWeek\(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek\)/);
  assert.match(stage, /setData\(\(current\) => \(\{[\s\S]*rangeStart: targetRangeStart,[\s\S]*rangeWeeks: SCHEDULE_BUFFER_WEEKS/);
  assert.match(stage, /setRangeStart\(targetRangeStart\)[\s\S]*setActiveWeekStart\(targetWeek\)/);
  assert.match(scheduleUi, /const calendarCanReschedule = canRescheduleJobs/);
  assert.match(scheduleUi, /stageScheduleChange\(appointment, date, minuteFromPointer/);
  assert.match(scheduleUi, /data-schedule-proposal draggable=\{Boolean\(onProposalChange\) && !busy && !loading\}/);
  assert.match(scheduleUi, /draggedProposalRef\.current = true/);
  assert.match(scheduleUi, /onProposalChange\(\{ startsAt: `\$\{date\}T\$\{minuteLabel\(minute\)\}`, durationMinutes: proposal\.durationMinutes \}\)/);
  assert.match(scheduleUi, /const \[pendingScheduleChanges, setPendingScheduleChanges\]/);
  assert.match(scheduleUi, /applyScheduleChangeDrafts\(scheduleChangeSources, scheduleChangeDrafts\)/);
  assert.match(scheduleUi, /action: "save_schedule_changes", changes/);
  assert.match(scheduleUi, /expectedRevision: change\.appointment\.revision/);
  assert.match(scheduleUi, /onClick=\{discardScheduleChanges\}[^>]*>Discard<\/button>/);
  assert.match(scheduleUi, /busy === "schedule-batch" \? "Saving\.\.\." : "Save schedule changes"/);
  assert.match(scheduleUi, /setPendingScheduleChanges\(\{\}\)[\s\S]*setEdits\(\{\}\)/);
  assert.match(scheduleUi, /item\.scheduleDraft \? " draft"/);
  assert.match(scheduleUi, /item\.scheduleDraft && <b>Unsaved<\/b>/);
});

test("the phone-safe detail editor stages the same date, time, worker and duration draft", () => {
  assert.match(scheduleUi, /className="crm-invoice-preview-dialog schedule-appointment-dialog"/);
  assert.match(scheduleUi, /type="date" min=\{minimumStart\.slice\(0, 10\)\} value=\{edit\.date\}/);
  assert.match(scheduleUi, /<select value=\{edit\.time\}/);
  assert.match(scheduleUi, /DurationControl id=\{`appointment-duration-\$\{selectedAppointment\.id\}`\} value=\{edit\.durationMinutes\}/);
  assert.match(scheduleUi, /stageScheduleChange\(selectedAppointment, edit\.date, minuteValue\(edit\.time\), edit\.memberId, edit\.durationMinutes\)/);
  assert.match(scheduleStyles, /\.schedule-block \{[^}]*touch-action: manipulation/);
  assert.match(scheduleStyles, /\.schedule-block\.moveable \{[^}]*cursor: grab/);
  assert.match(scheduleStyles, /\.schedule-pending-actions[\s\S]*min-height: 44px/);
  assert.match(scheduleStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.schedule-pending-actions \{ grid-template-columns: 1fr 1fr; \}[\s\S]*?\.schedule-appointment-details \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(scheduleStyles, /@media \(max-width: 480px\) \{[\s\S]*?\.crm-invoice-preview-dialog \.schedule-selection-fields \{ grid-template-columns: 1fr; \}/);
  assert.match(scheduleStyles, /\.crm-job-schedule-layout > \.job-calendar \{ order: 2; \}/);
  assert.match(scheduleStyles, /\.crm-job-schedule-controls \{[^}]*order: 1/);
  assert.match(scheduleUi, /function closeAppointment\(\)[\s\S]*setEdits\(\(current\) =>/);
  assert.match(scheduleUi, /function leaveSchedule\(action: \(\) => void\)[\s\S]*window\.confirm\("You have unsaved schedule changes\. Leave and discard them\?"\)/);
});
