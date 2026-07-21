import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacentScheduleWeek,
  mergeDraggedScheduleAppointment,
  scheduleDragEdgeDirection,
  scheduleRangeContainsWeek,
  scheduleWeekDays,
  scheduleWeekSwipeDirection,
} from "../src/lib/trade-schedule.ts";

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
