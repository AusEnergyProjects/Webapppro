const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const STATE_TIME_ZONES: Record<string, string> = {
  ACT: "Australia/Sydney", NSW: "Australia/Sydney", NT: "Australia/Darwin", QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide", TAS: "Australia/Hobart", VIC: "Australia/Melbourne", WA: "Australia/Perth",
};

export type WorkingWindow = { isAvailable: boolean; startMinute: number; endMinute: number };
export type ScheduleLaneItem = { id: string; startsAt: string; endsAt: string };
export type ScheduleLane = { lane: number; laneCount: number };
export type ScheduleConflictItem = ScheduleLaneItem & { assigneeMemberId?: unknown };
export type ScheduleDisplayWindow = { startMinute: number; endMinute: number };
export type ScheduleWeekSwipeInput = {
  deltaX: number;
  deltaY: number;
  startedOnAppointment?: boolean;
  dragActive?: boolean;
  requireBoundary?: boolean;
  atStartBoundary?: boolean;
  atEndBoundary?: boolean;
  threshold?: number;
};
export const APPOINTMENT_MIN_DURATION_MINUTES = 15;
export const APPOINTMENT_MAX_DURATION_MINUTES = 8 * 60;
export const APPOINTMENT_DURATION_STEP_MINUTES = 15;
export const SCHEDULE_MAX_RANGE_WEEKS = 8;

export function normaliseWeekStart(value: unknown) {
  const date = String(value || "");
  if (!DATE_PATTERN.test(date)) throw new Error("INVALID_WEEK");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDay() !== 1 || parsed.toISOString().slice(0, 10) !== date) throw new Error("INVALID_WEEK");
  return date;
}

export function normaliseScheduleRangeWeeks(value: unknown, fallback = 1) {
  const weeks = value === "" || value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > SCHEDULE_MAX_RANGE_WEEKS) throw new Error("INVALID_SCHEDULE_RANGE");
  return weeks;
}

export function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function scheduleWeekDays(weekStart: string) {
  const start = normaliseWeekStart(weekStart);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

export function adjacentScheduleWeek(weekStart: string, direction: -1 | 1) {
  return addCalendarDays(normaliseWeekStart(weekStart), direction * 7);
}

export function scheduleRangeContainsWeek(rangeStart: string, rangeWeeks: number, weekStart: string) {
  const start = normaliseWeekStart(rangeStart);
  const target = normaliseWeekStart(weekStart);
  const weeks = normaliseScheduleRangeWeeks(rangeWeeks);
  return target >= start && addCalendarDays(target, 7) <= addCalendarDays(start, weeks * 7);
}

export function scheduleWeekSwipeDirection({
  deltaX,
  deltaY,
  startedOnAppointment = false,
  dragActive = false,
  requireBoundary = false,
  atStartBoundary = false,
  atEndBoundary = false,
  threshold = 64,
}: ScheduleWeekSwipeInput): -1 | 0 | 1 {
  if (startedOnAppointment || dragActive || Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return 0;
  const direction = deltaX < 0 ? 1 : -1;
  if (requireBoundary && (direction === 1 ? !atEndBoundary : !atStartBoundary)) return 0;
  return direction;
}

export function scheduleDragEdgeDirection(clientX: number, left: number, right: number, dragActive: boolean, threshold = 72): -1 | 0 | 1 {
  if (!dragActive || right <= left) return 0;
  if (clientX <= left + threshold) return -1;
  if (clientX >= right - threshold) return 1;
  return 0;
}

export function mergeDraggedScheduleAppointment<T extends { id: string }>(appointments: T[], dragged: T | null) {
  if (!dragged || appointments.some((appointment) => appointment.id === dragged.id)) return appointments;
  return [...appointments, dragged];
}

export function normaliseLocalDateTime(value: unknown) {
  const dateTime = String(value || "");
  if (!LOCAL_DATE_TIME_PATTERN.test(dateTime)) throw new Error("INVALID_TIME");
  const parsed = new Date(`${dateTime}:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 16) !== dateTime) throw new Error("INVALID_TIME");
  return dateTime;
}

export function australiaLocalDateTime(addressState = "NSW", value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATE_TIME_ZONES[addressState] || STATE_TIME_ZONES.NSW,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function browserLocalDateTime(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function nextAppointmentSlot(value = new Date(), leadMinutes = 15) {
  const stepMs = APPOINTMENT_DURATION_STEP_MINUTES * 60_000;
  const earliest = value.getTime() + Math.max(0, leadMinutes) * 60_000;
  return browserLocalDateTime(new Date(Math.ceil(earliest / stepMs) * stepMs));
}

export function assertAppointmentSlot(startsAt: string) {
  const start = normaliseLocalDateTime(startsAt);
  if (Number(start.slice(14, 16)) % APPOINTMENT_DURATION_STEP_MINUTES !== 0) throw new Error("INVALID_APPOINTMENT_SLOT");
  return start;
}

export function assertFutureAppointment(startsAt: string, localNow: string) {
  const start = normaliseLocalDateTime(startsAt);
  const now = normaliseLocalDateTime(localNow);
  if (start <= now) throw new Error("PAST_APPOINTMENT");
  return start;
}

export function normaliseAppointmentDuration(value: unknown, fallback = 60) {
  const duration = value === "" || value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(duration)
    || duration < APPOINTMENT_MIN_DURATION_MINUTES
    || duration > APPOINTMENT_MAX_DURATION_MINUTES
    || duration % APPOINTMENT_DURATION_STEP_MINUTES !== 0) throw new Error("INVALID_DURATION");
  return duration;
}

export function appointmentEndsAt(startsAt: unknown, durationMinutes: unknown, fallback = 60) {
  const start = normaliseLocalDateTime(startsAt);
  const duration = normaliseAppointmentDuration(durationMinutes, fallback);
  return new Date(Date.parse(`${start}:00Z`) + duration * 60_000).toISOString().slice(0, 16);
}

export function appointmentDurationMinutes(startsAt: string, endsAt: string, fallback = 60) {
  try {
    const start = normaliseLocalDateTime(startsAt);
    const end = normaliseLocalDateTime(endsAt);
    const minutes = (Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60_000;
    if (minutes <= 0) return normaliseAppointmentDuration(fallback);
    const stepped = Math.round(minutes / APPOINTMENT_DURATION_STEP_MINUTES) * APPOINTMENT_DURATION_STEP_MINUTES;
    return Math.min(APPOINTMENT_MAX_DURATION_MINUTES, Math.max(APPOINTMENT_MIN_DURATION_MINUTES, stepped));
  } catch { return normaliseAppointmentDuration(fallback); }
}

export function scheduleAppointmentLanes(items: ScheduleLaneItem[]) {
  const layout = new Map<string, ScheduleLane>();
  const ordered = items.map((item) => {
    const start = Date.parse(`${normaliseLocalDateTime(item.startsAt)}:00Z`);
    return { ...item, start, end: start + appointmentDurationMinutes(item.startsAt, item.endsAt) * 60_000 };
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  let cluster: typeof ordered = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const placeCluster = () => {
    const laneEnds: number[] = [];
    const placements: Array<{ id: string; lane: number }> = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(item.end); }
      else laneEnds[lane] = item.end;
      placements.push({ id: item.id, lane });
    }
    const laneCount = Math.max(1, laneEnds.length);
    for (const placement of placements) layout.set(placement.id, { lane: placement.lane, laneCount });
  };
  for (const item of ordered) {
    if (cluster.length && item.start >= clusterEnd) {
      placeCluster(); cluster = []; clusterEnd = Number.NEGATIVE_INFINITY;
    }
    cluster.push(item); clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) placeCluster();
  return layout;
}

export function scheduleConflictIds(items: ScheduleConflictItem[]) {
  const conflicts = new Set<string>();
  const byAssignee = new Map<string, ScheduleConflictItem[]>();
  for (const item of items) {
    const assignee = String(item.assigneeMemberId || "");
    if (!assignee) continue;
    const current = byAssignee.get(assignee) || [];
    current.push(item); byAssignee.set(assignee, current);
  }
  for (const assignedItems of byAssignee.values()) {
    const ordered = [...assignedItems].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt) || a.id.localeCompare(b.id));
    let cluster: ScheduleConflictItem[] = [];
    let clusterEnd = "";
    const closeCluster = () => {
      if (cluster.length > 1) for (const item of cluster) conflicts.add(item.id);
      cluster = []; clusterEnd = "";
    };
    for (const item of ordered) {
      const end = item.endsAt || item.startsAt;
      if (cluster.length && item.startsAt >= clusterEnd) closeCluster();
      cluster.push(item); if (end > clusterEnd) clusterEnd = end;
    }
    closeCluster();
  }
  return conflicts;
}

export function scheduleDisplayWindow(items: ScheduleLaneItem[], defaultStartMinute = 7 * 60, defaultEndMinute = 19 * 60): ScheduleDisplayWindow {
  let startMinute = defaultStartMinute;
  let endMinute = defaultEndMinute;
  for (const item of items) {
    const start = localDayAndMinute(item.startsAt).minute;
    const duration = appointmentDurationMinutes(item.startsAt, item.endsAt);
    startMinute = Math.min(startMinute, Math.floor(Math.max(0, start - 30) / 60) * 60);
    endMinute = Math.max(endMinute, Math.ceil(Math.min(24 * 60, start + duration + 30) / 60) * 60);
  }
  return { startMinute: Math.max(0, startMinute), endMinute: Math.min(24 * 60, endMinute) };
}

export function durationLabel(minutes: number) {
  const duration = normaliseAppointmentDuration(minutes);
  const hours = Math.floor(duration / 60);
  const remainder = duration % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours}h ${remainder}m`;
}

export function moveAppointmentToDate(startsAt: string, endsAt: string, targetDate: string, localNow = browserLocalDateTime()) {
  const start = normaliseLocalDateTime(startsAt); const end = normaliseLocalDateTime(endsAt);
  if (!DATE_PATTERN.test(targetDate) || end <= start) throw new Error("INVALID_TIME");
  const duration = Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`);
  let nextStart = `${targetDate}T${start.slice(11)}`;
  if (nextStart <= localNow) {
    const rounded = new Date(`${normaliseLocalDateTime(localNow)}:00Z`);
    rounded.setUTCMinutes(Math.floor(rounded.getUTCMinutes() / 15) * 15 + 15, 0, 0);
    nextStart = rounded.toISOString().slice(0, 16);
    if (nextStart.slice(0, 10) !== targetDate) throw new Error("PAST_APPOINTMENT");
  }
  const nextEnd = new Date(Date.parse(`${nextStart}:00Z`) + duration).toISOString().slice(0, 16);
  return { startsAt: nextStart, endsAt: nextEnd };
}

export function localDayAndMinute(value: string) {
  const parsed = new Date(`${normaliseLocalDateTime(value)}:00Z`);
  return { date: value.slice(0, 10), weekday: parsed.getUTCDay(), minute: parsed.getUTCHours() * 60 + parsed.getUTCMinutes() };
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && startB < endA;
}

export function defaultWorkingWindow(weekday: number): WorkingWindow {
  return weekday >= 1 && weekday <= 5
    ? { isAvailable: true, startMinute: 9 * 60, endMinute: 17 * 60 }
    : { isAvailable: false, startMinute: 9 * 60, endMinute: 17 * 60 };
}

export function insideWorkingWindow(startsAt: string, endsAt: string, window: WorkingWindow) {
  const start = localDayAndMinute(startsAt);
  const end = localDayAndMinute(endsAt);
  return start.date === end.date && window.isAvailable && start.minute >= window.startMinute && end.minute <= window.endMinute && end.minute > start.minute;
}
