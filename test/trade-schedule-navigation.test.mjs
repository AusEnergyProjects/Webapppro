import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  adjacentScheduleWeek,
  invalidateScheduleProposal,
  mergeDraggedScheduleAppointment,
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

test("an appointment remains addressable while an adjacent week is shown", () => {
  const dragged = { id: "appointment-1", startsAt: "2026-07-20T09:00", revision: 4 };
  assert.deepEqual(mergeDraggedScheduleAppointment([], dragged), [dragged]);

  const authoritative = { id: "appointment-1", startsAt: "2026-07-27T11:00", revision: 5 };
  const merged = mergeDraggedScheduleAppointment([authoritative], dragged);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], authoritative);
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
