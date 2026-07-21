"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import type { User } from "firebase/auth";
import {
  APPOINTMENT_MAX_DURATION_MINUTES,
  APPOINTMENT_MIN_DURATION_MINUTES,
  adjacentScheduleWeek,
  appointmentDurationMinutes,
  appointmentEndsAt,
  browserLocalDateTime,
  durationLabel,
  mergeDraggedScheduleAppointment,
  moveAppointmentToDate,
  nextAppointmentSlot,
  scheduleDragEdgeDirection,
  scheduleAppointmentLanes,
  scheduleDisplayWindow,
  scheduleRangeContainsWeek,
  scheduleWeekDays,
  scheduleWeekSwipeDirection,
} from "@/lib/trade-schedule";
import {
  clearIntegrationReturnFromAddress,
  integrationProviderLabel,
  isCalendarIntegration,
  readIntegrationReturn,
} from "@/lib/trade-integration-return";

type Member = { id: string; displayName: string; role: string; status: string; isOwner: boolean };
type WorkingHours = { id?: string; teamMemberId: string; weekday: number; startMinute: number; endMinute: number; isAvailable: boolean };
type Unavailability = { id: string; teamMemberId: string; startsAt: string; endsAt: string; reason: string };
type Appointment = { id: string; workOrderId: string; workNumber: string; title: string; appointmentType: string; startsAt: string; endsAt: string; assigneeMemberId: string; assigneeLabel: string; status: string; revision: number; serviceCategory: string; customerDisplayName: string; suburbLabel: string; siteLabel: string; siteSummary: string; protectedJob: boolean; conflicts: boolean; outsideWorkingHours: boolean };
type RescheduleRequest = { id: string; appointmentId: string; workOrderId: string; workNumber: string; title: string; status: string;
  preferredWindows: Array<{ startsAt: string; endsAt: string }>; reason: string; accessNotes: string;
  originalStartsAt: string; originalEndsAt: string; proposedStartsAt: string; proposedEndsAt: string;
  proposedAssigneeMemberId: string; proposedAssigneeLabel: string; decisionNote: string; revision: number;
  requestedAt: string; decidedAt: string; currentStartsAt: string; currentEndsAt: string;
  currentAssigneeMemberId: string; currentAssigneeLabel: string; appointmentRevision: number };
type Job = { id: string; workNumber: string; title: string; serviceCategory: string; customerDisplayName: string; suburbLabel: string; siteLabel: string; siteSummary: string; priority: string; stage: string; revision: number; assigneeMemberId: string; assigneeLabel: string };
type AppointmentCalendarSync = { connected: number; synced: number; failed: number };
type ScheduleResult = { ok?: boolean; error?: string; weekStart?: string; weekEnd?: string; rangeStart?: string; rangeEnd?: string; rangeWeeks?: number; calendarSync?: AppointmentCalendarSync; members?: Member[]; workingHours?: WorkingHours[]; unavailability?: Unavailability[]; appointments?: Appointment[]; rescheduleRequests?: RescheduleRequest[]; unassignedJobs?: Job[] };
type Edit = { memberId: string; date: string; time: string; durationMinutes: number };
type CalendarConnection = { provider: "google_calendar" | "microsoft_calendar"; label: string; configured: boolean; status: "connected" | "not_connected"; lastSyncAt: string; lastError: string };
type CalendarResult = { ok?: boolean; error?: string; providers?: CalendarConnection[]; synced?: number; failed?: number };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const APPOINTMENT_PICKER_START_MINUTE = 6 * 60;
const APPOINTMENT_PICKER_END_MINUTE = 22 * 60;
const GRID_QUARTER_HEIGHT = 16;
const SCHEDULE_BUFFER_WEEKS = 3;
const SCHEDULE_BUFFER_LEADING_WEEKS = 1;
const SCHEDULE_EDGE_SCROLL_PX = 30;
const SCHEDULE_EDGE_HOVER_MS = 600;
const memberColours = ["green", "teal", "blue", "amber", "purple", "coral"];
const timeChoices = Array.from({ length: (APPOINTMENT_PICKER_END_MINUTE - APPOINTMENT_PICKER_START_MINUTE) / 15 }, (_, index) => {
  const minutes = APPOINTMENT_PICKER_START_MINUTE + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

function monday(value = new Date()) {
  const date = new Date(value); const day = date.getDay(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - ((day + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function calendarDayDistance(from: string, to: string) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000); }
function minuteLabel(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function minuteValue(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function defaultHours(weekday: number): WorkingHours { return { teamMemberId: "", weekday, startMinute: 540, endMinute: 1020, isAvailable: weekday >= 1 && weekday <= 5 }; }
function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function memberLabel(member: Member) { return member.isOwner ? "Me" : member.displayName; }
function editFromRange(memberId: string, startsAt: string, endsAt: string): Edit {
  return { memberId, date: startsAt.slice(0, 10), time: startsAt.slice(11, 16), durationMinutes: appointmentDurationMinutes(startsAt, endsAt) };
}
function editStart(edit: Edit) { return `${edit.date}T${edit.time}`; }
function formatTime(value: string) { return new Date(`${value}:00`).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); }
function formatDay(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }); }
function initialEdit(weekStart: string, localNow: string, memberId: string): Edit {
  let date = weekStart < localNow.slice(0, 10) ? localNow.slice(0, 10) : weekStart;
  let time = "09:00";
  if (`${date}T${time}` <= localNow) {
    const rounded = new Date(`${localNow}:00`); rounded.setMinutes(Math.floor(rounded.getMinutes() / 15) * 15 + 15, 0, 0);
    const roundedLocal = browserLocalDateTime(rounded);
    date = roundedLocal.slice(0, 10); time = roundedLocal.slice(11, 16);
    const roundedMinute = minuteValue(time);
    if (roundedMinute < APPOINTMENT_PICKER_START_MINUTE) time = "09:00";
    if (roundedMinute >= APPOINTMENT_PICKER_END_MINUTE) { date = addDays(date, 1); time = "09:00"; }
  }
  return { memberId, date, time, durationMinutes: 60 };
}

function initialScheduleWeekStart(initialWeekStart?: string) {
  if (initialWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(initialWeekStart)) return monday(new Date(`${initialWeekStart}T12:00:00`));
  if (typeof window === "undefined") return monday();
  const returned = readIntegrationReturn(window.location.search);
  return returned && isCalendarIntegration(returned.provider) && returned.weekStart ? returned.weekStart : monday();
}

function initialScheduleFocusDate(initialWeekStart?: string) {
  if (initialWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(initialWeekStart)) return initialWeekStart;
  if (typeof window === "undefined") return browserLocalDateTime().slice(0, 10);
  const returned = readIntegrationReturn(window.location.search);
  return returned && isCalendarIntegration(returned.provider) && returned.weekStart ? returned.weekStart : browserLocalDateTime().slice(0, 10);
}

function DurationControl({ id, value, onChange }: { id: string; value: number; onChange: (minutes: number) => void }) {
  return <label className="schedule-duration" htmlFor={id}><span>Duration <strong>{durationLabel(value)}</strong></span><input id={id} type="range" min={APPOINTMENT_MIN_DURATION_MINUTES} max={APPOINTMENT_MAX_DURATION_MINUTES} step="15" value={value} onChange={(event) => onChange(Number(event.target.value))} /><small>15 min</small><small>8 hours</small></label>;
}

export function TradeScheduleWorkspace({ user, onOpenJob = () => undefined, initialWeekStart }: { user: User; onOpenJob?: (workOrderId: string) => void; initialWeekStart?: string }) {
  const [initialTarget] = useState(() => initialScheduleWeekStart(initialWeekStart));
  const [initialFocusDate] = useState(() => initialScheduleFocusDate(initialWeekStart));
  const [rangeStart, setRangeStart] = useState(() => addDays(initialTarget, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
  const [activeWeekStart, setActiveWeekStart] = useState(initialTarget);
  const [data, setData] = useState<ScheduleResult>({});
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const [calendars, setCalendars] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [memberFilter, setMemberFilter] = useState(""); const [jobFilter, setJobFilter] = useState(""); const [serviceFilter, setServiceFilter] = useState(""); const [siteFilter, setSiteFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [conflictOnly, setConflictOnly] = useState(false);
  const [hoursMember, setHoursMember] = useState(""); const [hourEdits, setHourEdits] = useState<Record<number, WorkingHours>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({}); const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState(""); const [dropTarget, setDropTarget] = useState(""); const [dropMinute, setDropMinute] = useState(7 * 60);
  const [dragEdgeDirection, setDragEdgeDirection] = useState<-1 | 0 | 1>(0);
  const [browserNow, setBrowserNow] = useState(() => browserLocalDateTime());
  const minimumStart = useMemo(() => nextAppointmentSlot(new Date(`${browserNow}:00`), 0), [browserNow]);
  const todayDate = browserNow.slice(0, 10);
  const nowMinute = minuteValue(browserNow.slice(11, 16));
  const timetableScrollRef = useRef<HTMLDivElement>(null);
  const appointmentDialogRef = useRef<HTMLElement>(null);
  const selectedTriggerRef = useRef<HTMLElement | null>(null);
  const pendingFocusDateRef = useRef(initialFocusDate);
  const dragEdgeTimerRef = useRef<number | null>(null);
  const dragEdgeLockRef = useRef<-1 | 0 | 1>(0);
  const draggedAppointmentRef = useRef<Appointment | null>(null);
  const dragDropCommittedRef = useRef(false);
  const pendingDragScrollPositionRef = useRef<{ minute: number; left: number } | null>(null);
  const pendingWeekStartRef = useRef("");
  const loadedRangeStartRef = useRef("");
  const weekSwipeStartRef = useRef<{ x: number; y: number; startedOnAppointment: boolean; atStartBoundary: boolean; atEndBoundary: boolean } | null>(null);
  const suppressCardClickRef = useRef(false);
  const lastInitialWeekStartRef = useRef(initialWeekStart);
  const displayRangeStart = data.rangeStart || rangeStart;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const scheduleResponse = await fetch(`/api/trade-schedule?rangeStart=${rangeStart}&rangeWeeks=${SCHEDULE_BUFFER_WEEKS}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
      const result = await scheduleResponse.json().catch(() => ({})) as ScheduleResult;
      if (signal?.aborted) return;
      if (!scheduleResponse.ok || !result.ok) throw new Error(result.error || "The schedule could not be loaded.");
      const loadedRangeStart = result.rangeStart || rangeStart;
      loadedRangeStartRef.current = loadedRangeStart;
      setData(result); setHoursMember((current) => current || result.members?.[0]?.id || ""); setEdits({}); setDecisionNotes({});
      const pendingWeekStart = pendingWeekStartRef.current;
      if (pendingWeekStart && scheduleRangeContainsWeek(loadedRangeStart, result.rangeWeeks || SCHEDULE_BUFFER_WEEKS, pendingWeekStart)) {
        pendingWeekStartRef.current = "";
        setActiveWeekStart(pendingWeekStart);
      }
    } catch (error) {
      if (!signal?.aborted) {
        const failedPendingNavigation = Boolean(pendingWeekStartRef.current);
        pendingWeekStartRef.current = "";
        if (failedPendingNavigation) {
          pendingFocusDateRef.current = "";
          if (loadedRangeStartRef.current && loadedRangeStartRef.current !== rangeStart) setRangeStart(loadedRangeStartRef.current);
        }
        setStatus(error instanceof Error ? error.message : "The schedule could not be loaded.");
      }
    }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [rangeStart, user]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void load(controller.signal));
    return () => { controller.abort(); window.cancelAnimationFrame(frame); };
  }, [load]);
  useEffect(() => {
    if (data.rangeStart) loadedRangeStartRef.current = data.rangeStart;
  }, [data.rangeStart]);
  useEffect(() => {
    const timer = window.setInterval(() => setBrowserNow(browserLocalDateTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function loadCalendars() {
      try {
        const token = await user.getIdToken();
        const calendarResponse = await fetch("/api/trade-calendar-sync", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const calendarResult = await calendarResponse.json().catch(() => ({})) as CalendarResult;
        if (controller.signal.aborted) return;
        const returned = readIntegrationReturn(window.location.search);
        const calendarReturn = returned && isCalendarIntegration(returned.provider) ? returned : null;
        if (!calendarResponse.ok || !calendarResult.ok) {
          if (calendarReturn) setStatus(`${integrationProviderLabel(calendarReturn.provider)} returned to TLink, but the connection could not be checked. Refresh and try again.`);
          return;
        }
        const nextCalendars = calendarResult.providers || [];
        setCalendars(nextCalendars);
        if (!calendarReturn) return;
        const label = integrationProviderLabel(calendarReturn.provider);
        if (calendarReturn.status === "cancelled") setStatus(`${label} connection cancelled. Nothing was changed.`);
        else if (calendarReturn.status === "failed") setStatus(`${label} could not be connected. Try again or contact TLink support.`);
        else if (!nextCalendars.some((provider) => provider.provider === calendarReturn.provider && provider.status === "connected")) {
          setStatus(`${label} returned to TLink, but the connection could not be verified. Try connecting again.`);
        } else {
          const firstSyncResponse = await fetch("/api/trade-calendar-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ weekStart: initialTarget }),
            signal: controller.signal,
          });
          const firstSyncResult = await firstSyncResponse.json().catch(() => ({})) as CalendarResult;
          if (controller.signal.aborted) return;
          if (firstSyncResponse.ok && firstSyncResult.ok) {
            setCalendars(firstSyncResult.providers || nextCalendars);
            setStatus(firstSyncResult.failed
              ? `${label} connected. ${firstSyncResult.synced || 0} calendar items synced and ${firstSyncResult.failed} need another try.`
              : `${label} connected. ${firstSyncResult.synced || 0} calendar items are up to date.`);
          } else setStatus(`${label} connected. TLink is saved, but the first calendar sync needs another try.`);
        }
        clearIntegrationReturnFromAddress();
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Calendar connections could not be checked.");
      }
    }
    const frame = window.requestAnimationFrame(() => void loadCalendars());
    return () => { controller.abort(); window.cancelAnimationFrame(frame); };
  }, [initialTarget, user]);
  useEffect(() => {
    if (!hoursMember) return; const next: Record<number, WorkingHours> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) next[weekday] = data.workingHours?.find((row) => row.teamMemberId === hoursMember && row.weekday === weekday) || { ...defaultHours(weekday), teamMemberId: hoursMember };
    const frame = window.requestAnimationFrame(() => setHourEdits(next)); return () => window.cancelAnimationFrame(frame);
  }, [hoursMember, data.workingHours]);
  useEffect(() => {
    if (!initialWeekStart || lastInitialWeekStartRef.current === initialWeekStart) return;
    const target = initialScheduleWeekStart(initialWeekStart);
    const frame = window.requestAnimationFrame(() => {
      lastInitialWeekStartRef.current = initialWeekStart;
      pendingFocusDateRef.current = initialWeekStart; setFocusRequestVersion((current) => current + 1);
      if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, target)) setActiveWeekStart(target);
      else pendingWeekStartRef.current = target;
      setRangeStart(addDays(target, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayRangeStart, initialWeekStart]);
  useEffect(() => {
    if (!selectedAppointmentId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelectedAppointmentId(""); return; }
      if (event.key !== "Tab" || !appointmentDialogRef.current) return;
      const focusable = [...appointmentDialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKey);
      window.requestAnimationFrame(() => selectedTriggerRef.current?.focus());
    };
  }, [selectedAppointmentId]);
  useEffect(() => () => { if (dragEdgeTimerRef.current !== null) window.clearTimeout(dragEdgeTimerRef.current); }, []);
  async function update(body: Record<string, unknown>, key: string, success: string, responseWeekStart = activeWeekStart) {
    setBusy(key); setStatus("");
    try {
      const token = await user.getIdToken();
      const responseRangeStart = addDays(responseWeekStart, -SCHEDULE_BUFFER_LEADING_WEEKS * 7);
      const response = await fetch("/api/trade-schedule", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, rangeStart: responseRangeStart, rangeWeeks: SCHEDULE_BUFFER_WEEKS }) });
      const result = await response.json().catch(() => ({})) as ScheduleResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The schedule change could not be saved.");
      const loadedRangeStart = result.rangeStart || responseRangeStart;
      setData(result); setRangeStart(loadedRangeStart); setActiveWeekStart(responseWeekStart); setEdits({}); setDecisionNotes({});
      if (body.action === "schedule_appointment") closeAppointment();
      const changesAppointment = ["schedule_appointment", "schedule_job"].includes(String(body.action))
        || (body.action === "review_reschedule_request" && body.decision === "accepted");
      if (changesAppointment && result.calendarSync?.failed) setStatus(`${success} TLink is saved. A connected calendar item needs another sync.`);
      else if (changesAppointment && result.calendarSync?.synced) setStatus(`${success} Connected calendars are up to date.`);
      else setStatus(success);
      return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule change could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function connectCalendar(provider: CalendarConnection) {
    setBusy(`connect:${provider.provider}`); setStatus(`Opening ${provider.label} secure authorisation...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-integrations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: provider.provider, weekStart: activeWeekStart }) });
      const result = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "The calendar connection could not be started.");
      window.location.assign(result.authorizationUrl);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The calendar connection could not be started."); setBusy(""); }
  }

  async function syncCalendars() {
    setBusy("calendar-sync"); setStatus("Sending this TLink week to connected calendars...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-calendar-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ weekStart: activeWeekStart }) });
      const result = await response.json().catch(() => ({})) as CalendarResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The calendar sync could not be completed.");
      setCalendars(result.providers || calendars);
      setStatus(result.failed ? `${result.synced || 0} calendar items synced. ${result.failed} need another try.` : `${result.synced || 0} calendar items are up to date.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The calendar sync could not be completed."); }
    finally { setBusy(""); }
  }

  const members = useMemo(() => data.members || [], [data.members]);
  const appointments = useMemo(() => data.appointments || [], [data.appointments]);
  const appointmentsById = useMemo(() => new Map(appointments.map((item) => [item.id, item])), [appointments]);
  const services = useMemo(() => [...new Set([...appointments.map((item) => item.serviceCategory), ...(data.unassignedJobs || []).map((item) => item.serviceCategory)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const sites = useMemo(() => [...new Set([...appointments.map((item) => item.siteLabel), ...(data.unassignedJobs || []).map((item) => item.siteLabel)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const jobQuery = jobFilter.trim().toLowerCase();
  const visibleAppointments = useMemo(() => appointments.filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title} ${item.customerDisplayName} ${item.suburbLabel}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && (!conflictOnly || item.conflicts) && !["awaiting", "unassigned"].includes(statusFilter) && (statusFilter !== "conflict" || item.conflicts)), [appointments, conflictOnly, jobQuery, memberFilter, serviceFilter, siteFilter, statusFilter]);
  const visibleJobs = useMemo(() => (data.unassignedJobs || []).filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title} ${item.customerDisplayName} ${item.suburbLabel}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && !["scheduled", "conflict"].includes(statusFilter) && (statusFilter !== "unassigned" || !item.assigneeMemberId)), [data.unassignedJobs, jobQuery, memberFilter, serviceFilter, siteFilter, statusFilter]);
  const unassignedCount = visibleJobs.filter((item) => !item.assigneeMemberId).length;
  const bufferedWeekStarts = useMemo(() => Array.from({ length: SCHEDULE_BUFFER_WEEKS }, (_, index) => addDays(displayRangeStart, index * 7)), [displayRangeStart]);
  const activeWeekIndex = Math.max(0, Math.min(SCHEDULE_BUFFER_WEEKS - 1, Math.round(calendarDayDistance(displayRangeStart, activeWeekStart) / 7)));
  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>();
    for (const appointment of visibleAppointments) {
      const date = appointment.startsAt.slice(0, 10); const current = grouped.get(date) || [];
      current.push(appointment); grouped.set(date, current);
    }
    return grouped;
  }, [visibleAppointments]);
  const todayInRange = todayDate >= activeWeekStart && todayDate < addDays(activeWeekStart, 7);
  const todayAppointments = useMemo(() => appointments.filter((item) => item.startsAt.slice(0, 10) === todayDate)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.customerDisplayName.localeCompare(b.customerDisplayName)), [appointments, todayDate]);
  const activeWeekAppointments = useMemo(() => visibleAppointments.filter((item) => item.startsAt.slice(0, 10) >= activeWeekStart && item.startsAt.slice(0, 10) < addDays(activeWeekStart, 7)), [activeWeekStart, visibleAppointments]);
  const gridWindow = useMemo(() => scheduleDisplayWindow(activeWeekAppointments), [activeWeekAppointments]);
  const gridStartMinute = gridWindow.startMinute;
  const gridEndMinute = gridWindow.endMinute;
  const gridHeight = ((gridEndMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT;
  const timeLabels = useMemo(() => Array.from({ length: (gridEndMinute - gridStartMinute) / 60 + 1 }, (_, index) => gridStartMinute + index * 60), [gridEndMinute, gridStartMinute]);
  const activeWeekDays = useMemo(() => scheduleWeekDays(activeWeekStart), [activeWeekStart]);
  const ownerMemberId = members.find((member) => member.isOwner)?.id || members[0]?.id || "";
  const selectedAppointment = appointments.find((item) => item.id === selectedAppointmentId);

  useEffect(() => {
    const position = pendingDragScrollPositionRef.current;
    if (!position) return;
    const frame = window.requestAnimationFrame(() => {
      const container = timetableScrollRef.current;
      if (!container) return;
      container.scrollTop = Math.max(0, ((position.minute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT);
      container.scrollLeft = position.left;
      pendingDragScrollPositionRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeWeekStart, gridStartMinute]);

  const workingHoursByMemberAndDay = useMemo(() => new Map((data.workingHours || []).map((row) => [`${row.teamMemberId}:${row.weekday}`, row])), [data.workingHours]);
  function hoursFor(memberId: string, weekday: number) { return workingHoursByMemberAndDay.get(`${memberId}:${weekday}`) || { ...defaultHours(weekday), teamMemberId: memberId }; }
  const capacity = members.map((member) => {
    const available = activeWeekDays.reduce((total, date) => { const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); const row = hoursFor(member.id, weekday); return total + (row.isAvailable ? row.endMinute - row.startMinute : 0); }, 0);
    const activeWeekEnd = addDays(activeWeekStart, 7);
    const booked = appointments.filter((item) => item.assigneeMemberId === member.id && item.startsAt.slice(0, 10) >= activeWeekStart && item.startsAt.slice(0, 10) < activeWeekEnd).reduce((total, item) => total + appointmentDurationMinutes(item.startsAt, item.endsAt), 0);
    return { member, available, booked, percent: available ? Math.min(100, Math.round(booked / available * 100)) : booked ? 100 : 0 };
  });
  function colourFor(memberId: string) { const index = Math.max(0, members.findIndex((member) => member.id === memberId)); return memberColours[index % memberColours.length]; }

  const focusScheduleTime = useCallback((targetDate: string, behavior: ScrollBehavior = "smooth") => {
    const container = timetableScrollRef.current;
    if (!container) return;
    const firstAppointmentMinute = appointments.filter((item) => item.startsAt.slice(0, 10) === targetDate)
      .reduce((earliest, item) => Math.min(earliest, minuteValue(item.startsAt.slice(11, 16))), Number.POSITIVE_INFINITY);
    const focusMinute = Number.isFinite(firstAppointmentMinute) ? firstAppointmentMinute - 30 : targetDate === todayDate ? nowMinute - 60 : 9 * 60;
    const top = Math.max(0, ((Math.max(gridStartMinute, focusMinute) - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT - 42);
    container.scrollTo({ top, behavior });
  }, [appointments, gridStartMinute, nowMinute, todayDate]);

  useEffect(() => {
    const target = pendingFocusDateRef.current;
    if (!data.rangeStart || data.rangeStart !== rangeStart || !target) return;
    pendingFocusDateRef.current = "";
    const frame = window.requestAnimationFrame(() => focusScheduleTime(target, "auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [data.rangeStart, focusRequestVersion, focusScheduleTime, rangeStart]);

  function goToWeek(value: string, preserveBuffer = false) {
    const targetWeek = monday(new Date(`${value}T12:00:00`));
    if (preserveBuffer && !scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek)) return false;
    if (preserveBuffer) {
      const container = timetableScrollRef.current;
      pendingDragScrollPositionRef.current = {
        minute: gridStartMinute + ((container?.scrollTop || 0) / GRID_QUARTER_HEIGHT) * 15,
        left: container?.scrollLeft || 0,
      };
      setActiveWeekStart(targetWeek);
      return true;
    }
    pendingFocusDateRef.current = targetWeek;
    setFocusRequestVersion((current) => current + 1);
    if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek)) {
      pendingWeekStartRef.current = "";
      setActiveWeekStart(targetWeek);
    } else pendingWeekStartRef.current = targetWeek;
    setRangeStart(addDays(targetWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
    return true;
  }

  function goToToday() {
    const todayWeek = monday(new Date(`${todayDate}T12:00:00`));
    pendingFocusDateRef.current = todayDate;
    setFocusRequestVersion((current) => current + 1);
    if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, todayWeek)) {
      pendingWeekStartRef.current = "";
      setActiveWeekStart(todayWeek);
    } else pendingWeekStartRef.current = todayWeek;
    setRangeStart(addDays(todayWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
  }

  function startWeekSwipe(event: ReactTouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    const container = timetableScrollRef.current;
    weekSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedOnAppointment: Boolean((event.target as HTMLElement).closest("[data-schedule-appointment]")),
      atStartBoundary: !container || container.scrollLeft <= 2,
      atEndBoundary: !container || container.scrollLeft + container.clientWidth >= container.scrollWidth - 2,
    };
  }

  function finishWeekSwipe(event: ReactTouchEvent<HTMLElement>, requireBoundary = false) {
    const start = weekSwipeStartRef.current; const touch = event.changedTouches[0];
    weekSwipeStartRef.current = null;
    if (!start || !touch || loading) return;
    const direction = scheduleWeekSwipeDirection({ deltaX: touch.clientX - start.x, deltaY: touch.clientY - start.y, startedOnAppointment: start.startedOnAppointment, dragActive: Boolean(draggingId), requireBoundary, atStartBoundary: start.atStartBoundary, atEndBoundary: start.atEndBoundary });
    if (direction) goToWeek(adjacentScheduleWeek(activeWeekStart, direction));
  }

  function clearDragEdge(resetLock = false) {
    if (dragEdgeTimerRef.current !== null) window.clearTimeout(dragEdgeTimerRef.current);
    dragEdgeTimerRef.current = null;
    setDragEdgeDirection(0);
    if (resetLock) dragEdgeLockRef.current = 0;
  }

  function scheduleDragEdge(clientX: number) {
    const container = timetableScrollRef.current;
    if (!container || !draggedAppointmentRef.current) return;
    const bounds = container.getBoundingClientRect();
    const direction = scheduleDragEdgeDirection(clientX, bounds.left, bounds.right, true);
    const atScrollableEdge = direction < 0 ? container.scrollLeft <= 2 : direction > 0 ? container.scrollLeft + container.clientWidth >= container.scrollWidth - 2 : false;
    if (!direction || !atScrollableEdge) { clearDragEdge(true); return; }
    if (dragEdgeLockRef.current === direction || dragEdgeTimerRef.current !== null) return;
    const targetWeek = adjacentScheduleWeek(activeWeekStart, direction);
    if (!scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek)) return;
    setDragEdgeDirection(direction);
    dragEdgeTimerRef.current = window.setTimeout(() => {
      dragEdgeTimerRef.current = null; dragEdgeLockRef.current = direction; setDragEdgeDirection(0); setDropTarget("");
      goToWeek(targetWeek, true);
    }, SCHEDULE_EDGE_HOVER_MS);
  }

  function autoScrollDuringDrag(clientX: number, clientY: number) {
    const container = timetableScrollRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect(); const edge = 72;
    const left = clientX < bounds.left + edge ? -SCHEDULE_EDGE_SCROLL_PX : clientX > bounds.right - edge ? SCHEDULE_EDGE_SCROLL_PX : 0;
    const top = clientY < bounds.top + edge ? -SCHEDULE_EDGE_SCROLL_PX : clientY > bounds.bottom - edge ? SCHEDULE_EDGE_SCROLL_PX : 0;
    if (left || top) container.scrollBy({ left, top });
    scheduleDragEdge(clientX);
  }

  function openAppointment(appointmentId: string, trigger: HTMLElement) {
    if (suppressCardClickRef.current) return;
    selectedTriggerRef.current = trigger;
    setSelectedAppointmentId(appointmentId);
  }

  function closeAppointment() { setSelectedAppointmentId(""); }

  function minuteFromPointer(element: HTMLElement, clientY: number, durationMinutes: number) {
    const quarter = Math.round((clientY - element.getBoundingClientRect().top) / GRID_QUARTER_HEIGHT);
    const requested = gridStartMinute + quarter * 15;
    return Math.max(gridStartMinute, Math.min(gridEndMinute - durationMinutes, requested));
  }

  async function moveAppointment(appointment: Appointment, targetDate: string, targetMinute: number) {
    if (targetDate < minimumStart.slice(0, 10)) { setStatus("Appointments cannot be moved into the past."); return; }
    const edit = edits[appointment.id] || editFromRange(appointment.assigneeMemberId, appointment.startsAt, appointment.endsAt);
    const sourceWeek = monday(new Date(`${appointment.startsAt.slice(0, 10)}T12:00:00`));
    const targetWeek = monday(new Date(`${targetDate}T12:00:00`));
    try {
      const targetStart = `${appointment.startsAt.slice(0, 10)}T${minuteLabel(targetMinute)}`;
      const moved = moveAppointmentToDate(targetStart, appointmentEndsAt(targetStart, edit.durationMinutes), targetDate, minimumStart);
      const saved = await update({ action: "schedule_appointment", appointmentId: appointment.id, expectedRevision: appointment.revision,
        memberId: edit.memberId, startsAt: moved.startsAt, durationMinutes: edit.durationMinutes }, `appointment:${appointment.id}`, `${appointment.workNumber} moved to ${formatTime(moved.startsAt)} on ${targetDate}.`, targetWeek);
      if (!saved) {
        setData((current) => ({ ...current, appointments: mergeDraggedScheduleAppointment(current.appointments || [], appointment) }));
        setActiveWeekStart(sourceWeek); setRangeStart(addDays(sourceWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
      }
    } catch (error) {
      setData((current) => ({ ...current, appointments: mergeDraggedScheduleAppointment(current.appointments || [], appointment) }));
      setActiveWeekStart(sourceWeek); setRangeStart(addDays(sourceWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
      setStatus(error instanceof Error && error.message === "PAST_APPOINTMENT" ? "There is no future time left in that day. Choose another day." : "That appointment could not be moved.");
    }
    finally { clearDragEdge(true); draggedAppointmentRef.current = null; dragDropCommittedRef.current = false; setDraggingId(""); setDropTarget(""); setDropMinute(gridStartMinute); }
  }

  if (loading && !data.ok) return <section className="dashboard-panel schedule-workspace"><div className="crm-empty"><strong>Building the team schedule</strong><span>Loading appointments, availability and capacity.</span></div></section>;
  return <section className="dashboard-panel schedule-workspace" aria-busy={loading}>
    <header className="schedule-heading"><div><span>Dispatch calendar</span><h2>One clear week at a time</h2><p>See the week, move work quickly and open any appointment for precise details.</p></div><div className="schedule-week-nav"><button type="button" disabled={loading} onClick={() => goToWeek(adjacentScheduleWeek(activeWeekStart, -1))}>Previous week</button><button className="schedule-today-button" type="button" disabled={loading} onClick={goToToday}>Today</button><label><span>Go to week</span><input type="date" value={activeWeekStart} disabled={loading} onChange={(event) => { if (event.target.value) goToWeek(event.target.value); }} /></label><strong className="schedule-week-range" onTouchStart={startWeekSwipe} onTouchEnd={finishWeekSwipe}>{formatDay(activeWeekStart)} to {formatDay(addDays(activeWeekStart, 6))}<small>Swipe to change week</small></strong><button type="button" disabled={loading} onClick={() => goToWeek(adjacentScheduleWeek(activeWeekStart, 1))}>Next week</button></div></header>
    <section className="schedule-today-strip" aria-labelledby="schedule-today-title"><header><div><span>Today</span><strong id="schedule-today-title">{formatDay(todayDate)}</strong></div><b>{todayInRange ? `${todayAppointments.length} ${todayAppointments.length === 1 ? "appointment" : "appointments"}` : "Outside this week"}</b></header><div className="schedule-today-list">{todayInRange ? <>{todayAppointments.map((item) => <button type="button" key={item.id} onClick={(event) => { goToToday(); openAppointment(item.id, event.currentTarget); }}><strong>{formatTime(item.startsAt)} | {item.customerDisplayName}</strong><span>{item.assigneeLabel || "Unassigned"} | {item.suburbLabel}</span></button>)}{!todayAppointments.length && <p>No appointments today. Use the waiting jobs section below to add work.</p>}</> : <button type="button" onClick={goToToday}><strong>{"Load today's work"}</strong><span>Open the current week and jump straight to today.</span></button>}</div></section>
    <details className="schedule-filter-panel"><summary><span>Schedule filters</span><strong>{memberFilter || jobFilter || serviceFilter || siteFilter || statusFilter || conflictOnly ? "Filters active" : "Everyone and all work"}</strong></summary><div className="schedule-filters"><label><span>Person</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Job or customer</span><input value={jobFilter} placeholder="Customer, suburb or reference" onChange={(event) => setJobFilter(event.target.value)} /></label><label><span>Service</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service}>{readable(service)}</option>)}</select></label><label><span>Site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All schedule states</option><option value="scheduled">Scheduled</option><option value="conflict">Conflicts</option><option value="awaiting">Awaiting appointment</option><option value="unassigned">Unassigned</option></select></label><label className="schedule-check"><input type="checkbox" checked={conflictOnly} onChange={(event) => setConflictOnly(event.target.checked)} /><span>Conflicts only</span></label></div></details>
    {(data.rescheduleRequests || []).length > 0 && <details className="schedule-reschedule-queue"><summary><span>Customer requests</span><strong>Review before changing the schedule | {data.rescheduleRequests?.length}</strong></summary><div>{data.rescheduleRequests?.map((request) => {
      const preferred = request.preferredWindows[0]; const baseStart = request.proposedStartsAt || preferred?.startsAt || request.currentStartsAt; const baseEnd = request.proposedEndsAt || preferred?.endsAt || request.currentEndsAt;
      const edit = edits[request.id] || editFromRange(request.proposedAssigneeMemberId || request.currentAssigneeMemberId, baseStart, baseEnd); const startsAt = editStart(edit); const invalidTime = startsAt <= minimumStart;
      return <article key={request.id}><header><div><span>{request.workNumber} | {readable(request.status)}</span><strong>{request.title}</strong><small>Current: {request.currentStartsAt} | {durationLabel(appointmentDurationMinutes(request.currentStartsAt, request.currentEndsAt))}</small></div></header><p><strong>Reason</strong>{request.reason}</p>{request.accessNotes && <p><strong>Access notes</strong>{request.accessNotes}</p>}<div className="schedule-request-decision"><select aria-label={`Assigned staff for request ${request.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select><input type="datetime-local" min={minimumStart} step="900" aria-label={`Reviewed start for ${request.workNumber}`} value={startsAt} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, date: event.target.value.slice(0, 10), time: event.target.value.slice(11, 16) } }))} /><DurationControl id={`request-duration-${request.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [request.id]: { ...edit, durationMinutes } }))} /><input maxLength={500} value={decisionNotes[request.id] || ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Optional customer-facing response" /></div><div className="schedule-request-actions"><button type="button" disabled={busy === `reject:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "rejected", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "" }, `reject:${request.id}`, `${request.workNumber} request rejected without changing the schedule.`)}>Reject</button><button type="button" disabled={!edit.memberId || invalidTime || busy === `alternative:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "alternative_proposed", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `alternative:${request.id}`, `${request.workNumber} alternative proposed without changing the schedule.`)}>Propose alternative</button><button className="primary" type="button" disabled={!edit.memberId || invalidTime || busy === `accept:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "accepted", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `accept:${request.id}`, `${request.workNumber} appointment change accepted.`)}>Accept and reschedule</button></div></article>;
    })}</div></details>}
    <p className="schedule-drag-note">Drag within this week. Hold at the left or right edge to open the adjacent week. Tap or press Enter for exact details.</p>
    <div className="schedule-week-viewport" onTouchStart={startWeekSwipe} onTouchEnd={(event) => finishWeekSwipe(event, true)} onTouchCancel={() => { weekSwipeStartRef.current = null; }} onDragOver={(event) => { if (draggingId) autoScrollDuringDrag(event.clientX, event.clientY); }}>
      {draggingId && <><span className={`schedule-drag-edge previous${dragEdgeDirection === -1 ? " active" : ""}`}>Hold for previous week</span><span className={`schedule-drag-edge next${dragEdgeDirection === 1 ? " active" : ""}`}>Hold for next week</span></>}
      <div className="schedule-week-pages" style={{ transform: `translateX(-${activeWeekIndex * 100}%)` }}>
      {bufferedWeekStarts.map((bufferedWeekStart) => {
        const days = scheduleWeekDays(bufferedWeekStart);
        const pageIsActive = bufferedWeekStart === activeWeekStart;
        return <section key={bufferedWeekStart} className="schedule-week-page" aria-hidden={!pageIsActive}>
        <div ref={pageIsActive ? timetableScrollRef : undefined} className="schedule-timetable-scroll" onDragOver={(event) => { if (draggingId) autoScrollDuringDrag(event.clientX, event.clientY); }}>
        <div className="schedule-timetable">
        <div className="schedule-time-rail" style={{ background: "#fff", left: 0, position: "sticky", zIndex: 20 }}><div className="schedule-time-heading">Time</div><div className="schedule-time-track" style={{ height: `${gridHeight}px` }}>{timeLabels.map((minute) => <span key={minute} style={{ top: `${((minute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`2000-01-01T${minuteLabel(minute)}`)}</span>)}</div></div>
        {days.map((date) => {
          const dayIsPast = date < minimumStart.slice(0, 10);
          const dayIsToday = date === todayDate;
          const dayAppointments = appointmentsByDate.get(date) || [];
          const appointmentLanes = scheduleAppointmentLanes(dayAppointments);
          return <section key={date} aria-label={`${dayIsToday ? "Today, " : ""}${formatDay(date)}`} className={`schedule-day-track${dropTarget === date ? " drop-target" : ""}${dayIsPast ? " past" : ""}${dayIsToday ? " today" : ""}`}>
            <header aria-current={dayIsToday ? "date" : undefined}><strong>{dayIsToday ? "Today" : shortDays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</strong><span>{date.slice(5)}</span></header>
            <div className="schedule-day-grid" style={{ height: `${gridHeight}px` }}
              onDragOver={(event) => {
                const appointment = draggedAppointmentRef.current || appointmentsById.get(draggingId);
                if (!dayIsPast && appointment) {
                  event.preventDefault(); autoScrollDuringDrag(event.clientX, event.clientY); setDropTarget(date);
                  setDropMinute(minuteFromPointer(event.currentTarget, event.clientY, appointmentDurationMinutes(appointment.startsAt, appointment.endsAt)));
                }
              }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(""); }}
              onDrop={(event) => { event.preventDefault(); clearDragEdge(); const appointment = draggedAppointmentRef.current || appointmentsById.get(draggingId || event.dataTransfer.getData("text/plain")); if (appointment) { dragDropCommittedRef.current = true; void moveAppointment(appointment, date, minuteFromPointer(event.currentTarget, event.clientY, appointmentDurationMinutes(appointment.startsAt, appointment.endsAt))); } }}>
              {dayIsToday && nowMinute >= gridStartMinute && nowMinute <= gridEndMinute && <span className="schedule-now-line" style={{ top: `${((nowMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}><i>Now</i></span>}
              {dropTarget === date && <span className="schedule-drop-guide" style={{ top: `${((dropMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`${date}T${minuteLabel(dropMinute)}`)}</span>}
              {dayAppointments.map((item) => {
                const startMinute = minuteValue(item.startsAt.slice(11, 16)); const duration = appointmentDurationMinutes(item.startsAt, item.endsAt); const top = Math.max(0, ((startMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT); const height = Math.max(62, (duration / 15) * GRID_QUARTER_HEIGHT);
                const lane = appointmentLanes.get(item.id) || { lane: 0, laneCount: 1 };
                const cardLabel = `${item.customerDisplayName}, ${item.assigneeLabel || "Unassigned"}, ${item.suburbLabel}, ${formatTime(item.startsAt)}`;
                return <article key={item.id} data-schedule-appointment draggable={!busy && !loading} tabIndex={pageIsActive ? 0 : -1} role="button" aria-label={`View appointment for ${cardLabel}`} className={`schedule-block ${colourFor(item.assigneeMemberId)}${item.conflicts ? " conflict" : ""}${selectedAppointmentId === item.id ? " selected" : ""}${draggingId === item.id ? " dragging" : ""}`} style={{ top: `${top}px`, height: `${height}px`, left: `calc(${lane.lane * 100 / lane.laneCount}% + 4px)`, right: "auto", width: `calc(${100 / lane.laneCount}% - 8px)` }}
                  onClick={(event) => openAppointment(item.id, event.currentTarget)}
                  onDoubleClick={(event) => { event.stopPropagation(); closeAppointment(); onOpenJob(item.workOrderId); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openAppointment(item.id, event.currentTarget); } }}
                  onDragStart={(event) => { suppressCardClickRef.current = true; draggedAppointmentRef.current = item; dragDropCommittedRef.current = false; dragEdgeLockRef.current = 0; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingId(item.id); setDropMinute(startMinute); }}
                  onDragEnd={() => { const dragged = draggedAppointmentRef.current; clearDragEdge(true); if (dragged && !dragDropCommittedRef.current) { const sourceWeek = monday(new Date(`${dragged.startsAt.slice(0, 10)}T12:00:00`)); setActiveWeekStart(sourceWeek); if (!scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, sourceWeek)) setRangeStart(addDays(sourceWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7)); } draggedAppointmentRef.current = null; dragDropCommittedRef.current = false; setDraggingId(""); setDropTarget(""); setDropMinute(gridStartMinute); window.setTimeout(() => { suppressCardClickRef.current = false; }, 0); }}>
                  <strong>{item.customerDisplayName}</strong><small>{item.assigneeLabel || "Unassigned"}</small><em>{item.suburbLabel}</em><span>{formatTime(item.startsAt)} | {durationLabel(duration)}</span>{item.outsideWorkingHours && <b>Outside hours</b>}{item.conflicts && <b>Conflict</b>}
                </article>;
              })}
              {dayIsToday && !dayAppointments.length && <span className="schedule-free-day">No jobs today</span>}
            </div>
          </section>;
        })}
      </div>
      </div>
      </section>;
      })}
      </div>
    </div>
    {selectedAppointment && (() => {
      const edit = edits[selectedAppointment.id] || editFromRange(selectedAppointment.assigneeMemberId, selectedAppointment.startsAt, selectedAppointment.endsAt); const startsAt = editStart(edit);
      return <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeAppointment(); }}>
        <section ref={appointmentDialogRef} className="crm-invoice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title">
          <header><div><span>Appointment</span><strong id="schedule-appointment-title">{selectedAppointment.customerDisplayName}</strong><small>{selectedAppointment.assigneeLabel || "Unassigned"} | {selectedAppointment.suburbLabel}</small></div><button type="button" autoFocus onClick={closeAppointment} aria-label="Close appointment details">Close</button></header>
          <div className="schedule-selection" style={{ border: 0, borderRadius: 0, overflowY: "auto" }}>
            <p><strong>{selectedAppointment.title}</strong><br />{readable(selectedAppointment.serviceCategory)} | {selectedAppointment.siteSummary || selectedAppointment.siteLabel}<br />Job reference {selectedAppointment.workNumber}</p>
            <div className="schedule-selection-fields"><label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`appointment-duration-${selectedAppointment.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, durationMinutes } }))} /></div>
            {status && <p className="crm-status schedule-dialog-status" role="status">{status}</p>}
          </div>
          <footer><button type="button" onClick={() => { closeAppointment(); onOpenJob(selectedAppointment.workOrderId); }}>Open full job</button><button className="primary" type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === `appointment:${selectedAppointment.id}`} onClick={() => void update({ action: "schedule_appointment", appointmentId: selectedAppointment.id, expectedRevision: selectedAppointment.revision, memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `appointment:${selectedAppointment.id}`, `${selectedAppointment.customerDisplayName} schedule updated.`)}>{busy === `appointment:${selectedAppointment.id}` ? "Saving..." : "Save appointment"}</button></footer>
        </section>
      </div>;
    })()}
    <details className="schedule-capacity"><summary><span>Team capacity</span><strong>Week of {activeWeekStart} | {unassignedCount} jobs waiting</strong></summary><div>{capacity.map(({ member, available, booked, percent }) => <article key={member.id}><span><i className={`schedule-person-dot ${colourFor(member.id)}`} />{memberLabel(member)}<small>{member.isOwner ? "Owner" : readable(member.role)}</small></span><strong>{Math.round(booked / 60)}h booked of {Math.round(available / 60)}h</strong><div><i style={{ width: `${percent}%` }} /></div></article>)}</div></details>
    <details className="schedule-calendar-links"><summary><span>Calendar apps</span><strong>Google Calendar and Outlook</strong></summary><div><p>TLink stays authoritative. Connected calendars receive this week&apos;s job blocks and never control the TLink schedule.</p>{calendars.map((provider) => <article key={provider.provider}><div><strong>{provider.label}</strong><span>{provider.status === "connected" ? provider.lastError ? "Connected, last sync needs attention" : "Connected" : provider.configured ? "Available to connect" : "TLink setup in progress"}</span></div><button type="button" disabled={!provider.configured || provider.status === "connected" || Boolean(busy)} onClick={() => void connectCalendar(provider)}>{provider.status === "connected" ? "Connected" : provider.configured ? `Connect ${provider.label}` : "TLink setup in progress"}</button></article>)}<button className="primary" type="button" disabled={!calendars.some((item) => item.status === "connected") || Boolean(busy)} onClick={() => void syncCalendars()}>{busy === "calendar-sync" ? "Syncing..." : "Sync this week"}</button></div></details>
    <div className="schedule-lower-grid"><section className="schedule-unassigned"><header><div><span>Ready to schedule</span><h3>Choose a start and job length</h3></div><strong>{visibleJobs.length}</strong></header>{visibleJobs.map((job) => { const edit = edits[job.id] || initialEdit(activeWeekStart, minimumStart, job.assigneeMemberId || ownerMemberId); const startsAt = editStart(edit); return <article key={job.id}><div><span>{job.customerDisplayName} | {readable(job.priority)}</span><strong>{job.title}</strong><small>{job.suburbLabel} | {readable(job.serviceCategory)}</small></div><label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`job-duration-${job.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [job.id]: { ...edit, durationMinutes } }))} /><button type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === `job:${job.id}`} onClick={() => void update({ action: "schedule_job", workOrderId: job.id, expectedRevision: job.revision, memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `job:${job.id}`, `${job.customerDisplayName} added to the schedule.`)}>Add to schedule</button></article>; })}{!visibleJobs.length && <div className="crm-empty"><strong>No work waiting</strong><span>Every visible active job already has a scheduled appointment.</span></div>}</section>
      <details className="schedule-availability"><summary><span>Availability</span><strong>Set working hours and time off</strong></summary><div className="schedule-availability-content"><label><span>Person</span><select value={hoursMember} onChange={(event) => setHoursMember(event.target.value)}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>{hoursMember && <div className="schedule-hours-grid">{dayNames.map((day, weekday) => { const row = hourEdits[weekday] || { ...defaultHours(weekday), teamMemberId: hoursMember }; return <article key={day}><label><input type="checkbox" checked={row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, isAvailable: event.target.checked } }))} />{day}</label><input type="time" value={minuteLabel(row.startMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, startMinute: minuteValue(event.target.value) } }))} /><input type="time" value={minuteLabel(row.endMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, endMinute: minuteValue(event.target.value) } }))} /><button type="button" disabled={busy === `hours:${weekday}`} onClick={() => void update({ action: "save_working_hours", memberId: hoursMember, weekday, startMinute: row.startMinute, endMinute: row.endMinute, isAvailable: row.isAvailable }, `hours:${weekday}`, `${day} hours saved.`)}>Save</button></article>; })}</div>}
        {hoursMember && <form className="schedule-unavailable-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ action: "add_unavailability", memberId: hoursMember, startsAt: form.get("startsAt"), endsAt: form.get("endsAt"), reason: form.get("reason") }, "unavailable", "Unavailable time recorded."); event.currentTarget.reset(); }}><strong>Add unavailable time</strong><input name="startsAt" type="datetime-local" required /><input name="endsAt" type="datetime-local" required /><input name="reason" maxLength={200} placeholder="Leave, training or other reason" /><button disabled={busy === "unavailable"}>Add</button></form>}
        <div className="schedule-unavailable-list">{(data.unavailability || []).filter((item) => !hoursMember || item.teamMemberId === hoursMember).map((item) => <article key={item.id}><div><strong>{item.reason}</strong><span>{item.startsAt} to {item.endsAt}</span></div><button type="button" onClick={() => void update({ action: "remove_unavailability", id: item.id }, `remove:${item.id}`, "Unavailable time removed.")}>Remove</button></article>)}</div></div></details></div>
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}
