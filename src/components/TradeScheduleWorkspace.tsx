"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import type { User } from "firebase/auth";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import {
  APPOINTMENT_MAX_DURATION_MINUTES,
  APPOINTMENT_MIN_DURATION_MINUTES,
  adjacentScheduleWeek,
  applyScheduleChangeDrafts,
  appointmentDurationMinutes,
  appointmentEndsAt,
  browserLocalDateTime,
  durationLabel,
  insideWorkingWindow,
  invalidateScheduleProposal,
  moveAppointmentToDate,
  nextAppointmentSlot,
  rangesOverlap,
  scheduleProposalKey,
  scheduleProposalValidation,
  scheduleDragEdgeDirection,
  scheduleMemberLabel,
  scheduleMinuteFromGridPosition,
  scheduleAppointmentLanes,
  scheduleAppointmentBlockHeight,
  scheduleChangeConflictIds,
  scheduleDisplayWindow,
  scheduleProposalDurationFromEndMinute,
  scheduleRangeContainsWeek,
  scheduleWeekDays,
  scheduleWeekSwipeDirection,
  type ScheduleProposalValidation,
  type ScheduleChangeDraft,
} from "@/lib/trade-schedule";
import {
  clearIntegrationReturnFromAddress,
  integrationProviderLabel,
  isCalendarIntegration,
  readIntegrationReturn,
} from "@/lib/trade-integration-return";

type ScheduleColour = "emerald" | "teal" | "blue" | "violet" | "amber" | "rose";
type Member = { id: string; displayName: string; status: string; isOwner: boolean; scheduleColour: ScheduleColour };
type WorkingHours = { id?: string; teamMemberId: string; weekday: number; startMinute: number; endMinute: number; isAvailable: boolean };
type Unavailability = { id: string; teamMemberId: string; startsAt: string; endsAt: string; reason: string };
type Appointment = { id: string; workOrderId: string; workNumber: string; title: string; appointmentType: string; startsAt: string; endsAt: string; assigneeMemberId: string; assigneeLabel: string; status: string; revision: number; serviceCategory: string; customerDisplayName: string; suburbLabel: string; siteLabel: string; siteSummary: string; siteAddress?: string; addressLine1?: string; addressLine2?: string; addressSuburb?: string; addressState?: string; addressPostcode?: string; customerPhone: string; customerEmail: string; notes: string; quoteStatus: string; quotedValueCents: number; protectedJob: boolean; conflicts: boolean; outsideWorkingHours: boolean; scheduleDraft?: boolean };
type RescheduleRequest = { id: string; appointmentId: string; workOrderId: string; workNumber: string; title: string; status: string;
  preferredWindows: Array<{ startsAt: string; endsAt: string }>; reason: string; accessNotes: string;
  originalStartsAt: string; originalEndsAt: string; proposedStartsAt: string; proposedEndsAt: string;
  proposedAssigneeMemberId: string; proposedAssigneeLabel: string; decisionNote: string; revision: number;
  requestedAt: string; decidedAt: string; currentStartsAt: string; currentEndsAt: string;
  currentAssigneeMemberId: string; currentAssigneeLabel: string; appointmentRevision: number };
type Job = { id: string; workNumber: string; title: string; serviceCategory: string; customerDisplayName: string; suburbLabel: string; siteLabel: string; siteSummary: string; priority: string; stage: string; revision: number; assigneeMemberId: string; assigneeLabel: string };
type AppointmentCalendarSync = { connected: number; attempted: number; created: number; updated: number; unchanged: number; synced: number; failed: number };
type ScheduleResult = { ok?: boolean; error?: string; weekStart?: string; weekEnd?: string; rangeStart?: string; rangeEnd?: string; rangeWeeks?: number; calendarSync?: AppointmentCalendarSync; access?: { memberId: string; isOwner: boolean; permissions?: Pick<TradeTeamPermissions, "canAssignJobs" | "canRescheduleJobs" | "canManageTeam" | "jobScope" | "scheduleScope"> }; members?: Member[]; availabilityMembers?: Member[]; workingHours?: WorkingHours[]; unavailability?: Unavailability[]; appointments?: Appointment[]; rescheduleRequests?: RescheduleRequest[]; unassignedJobs?: Job[] };
type Edit = { memberId: string; date: string; time: string; durationMinutes: number };
type CalendarConnection = { provider: "google_calendar" | "microsoft_calendar"; label: string; configured: boolean; status: "connected" | "not_connected"; lastSyncAt: string; lastError: string };
type CalendarResult = { ok?: boolean; error?: string; providers?: CalendarConnection[]; attempted?: number; created?: number; updated?: number; unchanged?: number; synced?: number; failed?: number };
type ScheduleProposal = { startsAt: string; durationMinutes: number; assigneeMemberId: string; assigneeLabel: string; title: string };
type ScheduleProposalChange = { startsAt: string; durationMinutes: number };
type PendingScheduleChange = ScheduleChangeDraft & { appointment: Appointment };
type TradeScheduleWorkspaceProps = {
  user: User;
  permissions?: TradeTeamPermissions;
  onOpenJob?: (workOrderId: string) => void;
  onOpenQuote?: (workOrderId: string) => void;
  initialWeekStart?: string;
  variant?: "full" | "job";
  proposal?: ScheduleProposal;
  refreshNonce?: number;
  focusedMemberId?: string;
  proposalStatusId?: string;
  onProposalValidation?: (validation: ScheduleProposalValidation) => void;
  onProposalChange?: (proposal: ScheduleProposalChange) => void;
  onScheduleChanged?: () => void | Promise<void>;
};

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const APPOINTMENT_PICKER_START_MINUTE = 6 * 60;
const APPOINTMENT_PICKER_END_MINUTE = 22 * 60;
const GRID_QUARTER_HEIGHT = 16;
const SCHEDULE_BUFFER_WEEKS = 3;
const SCHEDULE_BUFFER_LEADING_WEEKS = 1;
const SCHEDULE_EDGE_SCROLL_PX = 30;
const SCHEDULE_EDGE_HOVER_MS = 600;
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
function money(cents: number) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }
function editFromRange(memberId: string, startsAt: string, endsAt: string): Edit {
  return { memberId, date: startsAt.slice(0, 10), time: startsAt.slice(11, 16), durationMinutes: appointmentDurationMinutes(startsAt, endsAt) };
}
function editStart(edit: Edit) { return `${edit.date}T${edit.time}`; }
function formatTime(value: string) { return new Date(`${value}:00`).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); }
function formatDay(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }); }
function appointmentSiteAddress(appointment: Appointment) {
  return appointment.siteAddress || [appointment.addressLine1, appointment.addressLine2, appointment.addressSuburb, appointment.addressState, appointment.addressPostcode].filter(Boolean).join(", ");
}
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

export function TradeScheduleWorkspace({ user, permissions, onOpenJob = () => undefined, onOpenQuote, initialWeekStart, variant = "full", proposal, refreshNonce = 0, focusedMemberId, proposalStatusId = "trade-schedule-proposal-status", onProposalValidation, onProposalChange, onScheduleChanged }: TradeScheduleWorkspaceProps) {
  const jobCalendar = variant === "job";
  const [initialTarget] = useState(() => initialScheduleWeekStart(initialWeekStart));
  const [initialFocusDate] = useState(() => initialScheduleFocusDate(initialWeekStart));
  const [rangeStart, setRangeStart] = useState(() => addDays(initialTarget, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
  const [activeWeekStart, setActiveWeekStart] = useState(initialTarget);
  const [data, setData] = useState<ScheduleResult>({});
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const [calendars, setCalendars] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [status, setStatus] = useState(""); const [loadError, setLoadError] = useState(""); const [failedWeekStart, setFailedWeekStart] = useState(""); const [loadAttemptNonce, setLoadAttemptNonce] = useState(0);
  const [memberFilter, setMemberFilter] = useState(() => jobCalendar ? focusedMemberId || proposal?.assigneeMemberId || "" : ""); const [jobFilter, setJobFilter] = useState(""); const [serviceFilter, setServiceFilter] = useState(""); const [siteFilter, setSiteFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [conflictOnly, setConflictOnly] = useState(false);
  const [hoursMember, setHoursMember] = useState(""); const [hourEdits, setHourEdits] = useState<Record<number, WorkingHours>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({}); const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [pendingScheduleChanges, setPendingScheduleChanges] = useState<Record<string, PendingScheduleChange>>({});
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
  const draggedProposalRef = useRef(false);
  const dragDropCommittedRef = useRef(false);
  const pendingDragScrollPositionRef = useRef<{ minute: number; left: number } | null>(null);
  const pendingWeekStartRef = useRef(initialTarget);
  const weekSwipeStartRef = useRef<{ x: number; y: number; startedOnAppointment: boolean; atStartBoundary: boolean; atEndBoundary: boolean } | null>(null);
  const suppressCardClickRef = useRef(false);
  const lastInitialWeekStartRef = useRef(initialWeekStart);
  const lastFocusedMemberIdRef = useRef(focusedMemberId);
  const displayRangeStart = data.rangeStart || rangeStart;
  const schedulePermissions = data.access?.permissions || permissions;
  const canAssignJobs = !schedulePermissions || schedulePermissions.canAssignJobs;
  const canRescheduleJobs = !schedulePermissions || schedulePermissions.canRescheduleJobs;
  const canManageAvailability = Boolean(data.access?.memberId) || !permissions;
  const canManageTeamAvailability = Boolean(data.access?.isOwner || data.access?.permissions?.canManageTeam);
  const memberLabel = (member: Member) => scheduleMemberLabel(member, data.access?.memberId || "");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError(""); setFailedWeekStart("");
    try {
      const token = await user.getIdToken();
      const scheduleResponse = await fetch(`/api/trade-schedule?rangeStart=${rangeStart}&rangeWeeks=${SCHEDULE_BUFFER_WEEKS}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
      const result = await scheduleResponse.json().catch(() => ({})) as ScheduleResult;
      if (signal?.aborted) return;
      if (!scheduleResponse.ok || !result.ok) throw new Error(result.error || "The schedule could not be loaded.");
      const loadedRangeStart = result.rangeStart || rangeStart;
      setData(result); setLoadError(""); setHoursMember((current) => current || result.access?.memberId || result.members?.[0]?.id || ""); setEdits({}); setDecisionNotes({});
      const pendingWeekStart = pendingWeekStartRef.current;
      if (pendingWeekStart && scheduleRangeContainsWeek(loadedRangeStart, result.rangeWeeks || SCHEDULE_BUFFER_WEEKS, pendingWeekStart)) {
        pendingWeekStartRef.current = "";
        setActiveWeekStart(pendingWeekStart);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setFailedWeekStart(pendingWeekStartRef.current);
        setLoadError(error instanceof Error ? error.message : "The schedule could not be loaded.");
      }
    }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [rangeStart, user]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => void load(controller.signal));
    return () => { controller.abort(); window.cancelAnimationFrame(frame); };
  }, [load, loadAttemptNonce, refreshNonce]);
  useEffect(() => {
    const timer = window.setInterval(() => setBrowserNow(browserLocalDateTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!jobCalendar || lastFocusedMemberIdRef.current === focusedMemberId) return;
    lastFocusedMemberIdRef.current = focusedMemberId;
    if (proposal) onProposalValidation?.(invalidateScheduleProposal(scheduleProposalKey(proposal.startsAt, proposal.durationMinutes, proposal.assigneeMemberId)));
    setMemberFilter(focusedMemberId || "");
  }, [focusedMemberId, jobCalendar, onProposalValidation, proposal]);
  useEffect(() => {
    if (permissions || jobCalendar) return;
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
  }, [initialTarget, jobCalendar, permissions, user]);
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
      if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, target)) {
        pendingWeekStartRef.current = ""; setActiveWeekStart(target);
      } else {
        pendingWeekStartRef.current = target;
        setRangeStart(addDays(target, -SCHEDULE_BUFFER_LEADING_WEEKS * 7));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [displayRangeStart, initialWeekStart]);
  useEffect(() => {
    if (!selectedAppointmentId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedAppointmentId("");
        setEdits((current) => {
          if (!(selectedAppointmentId in current)) return current;
          const next = { ...current };
          delete next[selectedAppointmentId];
          return next;
        });
        return;
      }
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
    const action = String(body.action || "");
    if (["save_working_hours", "add_unavailability", "remove_unavailability"].includes(action) && !canManageAvailability) {
      setStatus("Your access allows viewing this schedule, not changing availability."); return false;
    }
    if (["schedule_appointment", "schedule_job", "save_schedule_changes", "review_reschedule_request"].includes(action) && !canRescheduleJobs) {
      setStatus("Your access allows viewing this schedule, not rescheduling jobs."); return false;
    }
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
      const changesAppointment = ["schedule_appointment", "schedule_job", "save_schedule_changes"].includes(String(body.action))
        || (body.action === "review_reschedule_request" && body.decision === "accepted");
      if (changesAppointment && result.calendarSync?.failed) setStatus(`${success} TLink is saved. A connected calendar item needs another sync.`);
      else if (changesAppointment && ((result.calendarSync?.created || 0) + (result.calendarSync?.updated || 0)) > 0) setStatus(`${success} Connected calendars were updated and verified.`);
      else if (changesAppointment && result.calendarSync?.unchanged) setStatus(`${success} Connected calendars were checked and unchanged.`);
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
      const changed = (result.created || 0) + (result.updated || 0);
      if (result.failed) setStatus(`${changed} calendar items updated. ${result.failed} need another try.`);
      else if (changed) setStatus(`${changed} calendar items were updated and verified.`);
      else setStatus("No scheduled appointments needed syncing for this week.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The calendar sync could not be completed."); }
    finally { setBusy(""); }
  }

  const members = useMemo(() => data.members || [], [data.members]);
  const availabilityMembers = useMemo(() => {
    const members = data.availabilityMembers || [];
    return canManageTeamAvailability ? members : members.filter((member) => member.id === data.access?.memberId);
  }, [canManageTeamAvailability, data.access?.memberId, data.availabilityMembers]);
  const authoritativeAppointments = useMemo(() => data.appointments || [], [data.appointments]);
  const scheduleChangeDrafts = useMemo(() => Object.values(pendingScheduleChanges).map((change) => ({
    appointmentId: change.appointmentId,
    memberId: change.memberId,
    startsAt: change.startsAt,
    durationMinutes: change.durationMinutes,
  })), [pendingScheduleChanges]);
  const scheduleChangeSources = useMemo(() => {
    const sources = [...authoritativeAppointments];
    for (const pending of Object.values(pendingScheduleChanges)) {
      if (!sources.some((appointment) => appointment.id === pending.appointmentId)) sources.push(pending.appointment);
    }
    return sources;
  }, [authoritativeAppointments, pendingScheduleChanges]);
  const appointments = useMemo(() => applyScheduleChangeDrafts(scheduleChangeSources, scheduleChangeDrafts).map((appointment) => {
    if (!appointment.scheduleDraft) return appointment;
    const weekday = new Date(`${appointment.startsAt.slice(0, 10)}T00:00:00Z`).getUTCDay();
    const workingWindow = (data.workingHours || []).find((row) => row.teamMemberId === appointment.assigneeMemberId && row.weekday === weekday)
      || { ...defaultHours(weekday), teamMemberId: appointment.assigneeMemberId };
    return {
      ...appointment,
      assigneeLabel: members.find((member) => member.id === appointment.assigneeMemberId)?.displayName || appointment.assigneeLabel,
      outsideWorkingHours: !insideWorkingWindow(appointment.startsAt, appointment.endsAt, workingWindow),
    };
  }), [data.workingHours, members, scheduleChangeDrafts, scheduleChangeSources]);
  const visibleUnavailability = useMemo(() => (data.unavailability || [])
    .filter((item) => !memberFilter || item.teamMemberId === memberFilter), [data.unavailability, memberFilter]);
  const appointmentsById = useMemo(() => new Map(appointments.map((item) => [item.id, item])), [appointments]);
  const authoritativeAppointmentsById = useMemo(() => new Map(scheduleChangeSources.map((item) => [item.id, item])), [scheduleChangeSources]);
  const pendingConflictIds = useMemo(() => scheduleChangeConflictIds(scheduleChangeSources, scheduleChangeDrafts), [scheduleChangeDrafts, scheduleChangeSources]);
  const pendingUnavailableIds = useMemo(() => new Set(scheduleChangeDrafts.filter((change) => (data.unavailability || []).some((item) => item.teamMemberId === change.memberId
    && rangesOverlap(item.startsAt, item.endsAt, change.startsAt, appointmentEndsAt(change.startsAt, change.durationMinutes)))).map((change) => change.appointmentId)), [data.unavailability, scheduleChangeDrafts]);
  const proposalEndsAt = useMemo(() => {
    if (!proposal?.startsAt) return "";
    try { return appointmentEndsAt(proposal.startsAt, proposal.durationMinutes); }
    catch { return ""; }
  }, [proposal]);
  const proposalConflictIds = useMemo(() => new Set(appointments.filter((item) => Boolean(
    proposal?.assigneeMemberId && proposal.startsAt && proposalEndsAt
      && item.assigneeMemberId === proposal.assigneeMemberId
      && rangesOverlap(item.startsAt, item.endsAt || item.startsAt, proposal.startsAt, proposalEndsAt),
  )).map((item) => item.id)), [appointments, proposal, proposalEndsAt]);
  const proposalValidation = useMemo(() => scheduleProposalValidation({
    startsAt: proposal?.startsAt || "",
    endsAt: proposalEndsAt,
    assigneeMemberId: proposal?.assigneeMemberId || "",
    visibleMemberId: memberFilter,
    activeWeekStart,
    loadedRangeStart: data.rangeStart,
    loadedRangeWeeks: data.rangeWeeks || SCHEDULE_BUFFER_WEEKS,
    loading,
    loadFailed: Boolean(loadError),
    failedWeekStart,
    assigneeActive: !proposal?.assigneeMemberId || members.some((member) => member.id === proposal.assigneeMemberId),
    appointments,
    unavailability: data.unavailability || [],
  }), [activeWeekStart, appointments, data.rangeStart, data.rangeWeeks, data.unavailability, failedWeekStart, loadError, loading, memberFilter, members, proposal, proposalEndsAt]);
  const proposalHasConflict = proposalValidation.conflict;
  useEffect(() => { onProposalValidation?.(proposalValidation); }, [onProposalValidation, proposalValidation]);
  const services = useMemo(() => [...new Set([...appointments.map((item) => item.serviceCategory), ...(data.unassignedJobs || []).map((item) => item.serviceCategory)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const sites = useMemo(() => [...new Set([...appointments.map((item) => item.siteLabel), ...(data.unassignedJobs || []).map((item) => item.siteLabel)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const jobQuery = jobFilter.trim().toLowerCase();
  const visibleAppointments = useMemo(() => appointments.filter((item) => {
    const effectiveConflict = item.scheduleDraft ? pendingConflictIds.has(item.id) || pendingUnavailableIds.has(item.id) : item.conflicts;
    return (!memberFilter || item.assigneeMemberId === memberFilter)
      && (!jobQuery || `${item.workNumber} ${item.title} ${item.customerDisplayName} ${item.suburbLabel}`.toLowerCase().includes(jobQuery))
      && (!serviceFilter || item.serviceCategory === serviceFilter)
      && (!siteFilter || item.siteLabel === siteFilter)
      && (!conflictOnly || effectiveConflict)
      && !["awaiting", "unassigned"].includes(statusFilter)
      && (statusFilter !== "conflict" || effectiveConflict);
  }), [appointments, conflictOnly, jobQuery, memberFilter, pendingConflictIds, pendingUnavailableIds, serviceFilter, siteFilter, statusFilter]);
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
  const activeWeekUnavailability = useMemo(() => scheduleWeekDays(activeWeekStart).flatMap((date) => {
    const dayStart = `${date}T${minuteLabel(APPOINTMENT_PICKER_START_MINUTE)}`;
    const dayEnd = `${date}T${minuteLabel(APPOINTMENT_PICKER_END_MINUTE)}`;
    return visibleUnavailability.filter((item) => item.startsAt < dayEnd && item.endsAt > dayStart)
      .map((item) => ({ ...item, id: `unavailable:${item.id}:${date}`,
        startsAt: item.startsAt > dayStart ? item.startsAt : dayStart,
        endsAt: item.endsAt < dayEnd ? item.endsAt : dayEnd }));
  }), [activeWeekStart, visibleUnavailability]);
  const activeWeekDisplayAppointments = useMemo(() => {
    const displayItems = [...activeWeekAppointments, ...activeWeekUnavailability];
    if (!proposal?.startsAt || !proposalEndsAt || (memberFilter && memberFilter !== proposal.assigneeMemberId) || proposal.startsAt.slice(0, 10) < activeWeekStart || proposal.startsAt.slice(0, 10) >= addDays(activeWeekStart, 7)) return displayItems;
    return [...displayItems, { id: "job-schedule-proposal", startsAt: proposal.startsAt, endsAt: proposalEndsAt }];
  }, [activeWeekAppointments, activeWeekStart, activeWeekUnavailability, memberFilter, proposal, proposalEndsAt]);
  const gridWindow = useMemo(() => scheduleDisplayWindow(activeWeekDisplayAppointments), [activeWeekDisplayAppointments]);
  const gridStartMinute = gridWindow.startMinute;
  const gridEndMinute = gridWindow.endMinute;
  const gridHeight = ((gridEndMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT;
  const timeLabels = useMemo(() => Array.from({ length: (gridEndMinute - gridStartMinute) / 60 + 1 }, (_, index) => gridStartMinute + index * 60), [gridEndMinute, gridStartMinute]);
  const activeWeekDays = useMemo(() => scheduleWeekDays(activeWeekStart), [activeWeekStart]);
  const ownerMemberId = members.find((member) => member.isOwner)?.id || members[0]?.id || "";
  const selectedAppointment = appointments.find((item) => item.id === selectedAppointmentId);
  const calendarCanReschedule = canRescheduleJobs;
  const pendingScheduleChangeCount = scheduleChangeDrafts.length;
  const pendingScheduleHasConflict = scheduleChangeDrafts.some((change) => pendingConflictIds.has(change.appointmentId) || pendingUnavailableIds.has(change.appointmentId));
  const proposalGuidance = proposalValidation.status === "loading"
    ? "Loading the selected week before this booking can be saved."
    : proposalValidation.status === "load_error"
      ? "The selected week's calendar could not be loaded. Retry it before saving."
      : proposalValidation.status === "not_visible"
        ? "The selected booking's worker or week is not currently shown. Show the selected booking before saving."
        : proposalValidation.status === "assignee_unavailable"
          ? "This job's assigned worker is no longer active. Reassign the job before booking."
        : proposalValidation.status === "unavailable"
          ? "The selected person is unavailable during this time. Choose another time before saving."
          : proposalValidation.status === "conflict"
            ? "The selected time overlaps existing work. Choose another time before saving."
            : proposalValidation.status === "clear"
              ? "The selected time is clear in this loaded calendar. TLink checks again when you save."
              : "Choose the person and time beside this calendar to preview the booking.";

  useEffect(() => {
    if (!pendingScheduleChangeCount) return;
    const warnAboutUnsavedSchedule = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutUnsavedSchedule);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedSchedule);
  }, [pendingScheduleChangeCount]);

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
  function colourFor(memberId: string) { return members.find((member) => member.id === memberId)?.scheduleColour || "emerald"; }

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
    if (jobCalendar && targetWeek !== activeWeekStart) onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key));
    pendingFocusDateRef.current = targetWeek;
    setFocusRequestVersion((current) => current + 1);
    if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek)) {
      pendingWeekStartRef.current = "";
      setActiveWeekStart(targetWeek);
    } else {
      pendingWeekStartRef.current = targetWeek;
      const targetRangeStart = addDays(targetWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7);
      if (targetRangeStart === rangeStart) setLoadAttemptNonce((value) => value + 1);
      else setRangeStart(targetRangeStart);
    }
    return true;
  }

  function goToToday() {
    const todayWeek = monday(new Date(`${todayDate}T12:00:00`));
    if (jobCalendar && todayWeek !== activeWeekStart) onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key));
    pendingFocusDateRef.current = todayDate;
    setFocusRequestVersion((current) => current + 1);
    if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, todayWeek)) {
      pendingWeekStartRef.current = "";
      setActiveWeekStart(todayWeek);
    } else {
      pendingWeekStartRef.current = todayWeek;
      const targetRangeStart = addDays(todayWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7);
      if (targetRangeStart === rangeStart) setLoadAttemptNonce((value) => value + 1);
      else setRangeStart(targetRangeStart);
    }
  }

  function retryProposalWeek() {
    if (!proposal?.startsAt) { setLoadAttemptNonce((value) => value + 1); return; }
    const targetWeek = initialScheduleWeekStart(proposal.startsAt.slice(0, 10));
    const targetRangeStart = addDays(targetWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7);
    onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key, "loading"));
    pendingWeekStartRef.current = targetWeek;
    if (rangeStart === targetRangeStart) setLoadAttemptNonce((value) => value + 1);
    else setRangeStart(targetRangeStart);
  }

  function showProposal() {
    if (!proposal?.startsAt) return;
    onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key, "loading"));
    setMemberFilter(proposal.assigneeMemberId || "");
    goToWeek(proposal.startsAt.slice(0, 10));
  }

  function startWeekSwipe(event: ReactTouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    const container = timetableScrollRef.current;
    weekSwipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedOnAppointment: Boolean((event.target as HTMLElement).closest("[data-schedule-appointment], [data-schedule-proposal]")),
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
    if (!container || (!draggedAppointmentRef.current && !draggedProposalRef.current)) return;
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

  function closeAppointment() {
    const appointmentId = selectedAppointmentId;
    setSelectedAppointmentId("");
    if (!appointmentId) return;
    setEdits((current) => {
      if (!(appointmentId in current)) return current;
      const next = { ...current };
      delete next[appointmentId];
      return next;
    });
  }

  function leaveSchedule(action: () => void) {
    if (Object.keys(pendingScheduleChanges).length
      && !window.confirm("You have unsaved schedule changes. Leave and discard them?")) return;
    setPendingScheduleChanges({});
    setEdits({});
    closeAppointment();
    action();
  }

  function minuteFromPointer(element: HTMLElement, clientY: number, durationMinutes: number) {
    return scheduleMinuteFromGridPosition(clientY - element.getBoundingClientRect().top,
      gridStartMinute, gridEndMinute, durationMinutes, GRID_QUARTER_HEIGHT);
  }

  function selectProposalFromCalendar(element: HTMLElement, date: string, clientY: number) {
    if (!jobCalendar || !onProposalChange || !proposal?.assigneeMemberId || loading || date < minimumStart.slice(0, 10)) return;
    if (memberFilter && memberFilter !== proposal.assigneeMemberId) {
      onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key));
      return;
    }
    const earliestMinute = date === minimumStart.slice(0, 10)
      ? Math.max(gridStartMinute, minuteValue(minimumStart.slice(11, 16)))
      : gridStartMinute;
    if (earliestMinute > gridEndMinute - 60) return;
    const selectedMinute = Math.max(earliestMinute,
      scheduleMinuteFromGridPosition(clientY - element.getBoundingClientRect().top,
        gridStartMinute, gridEndMinute, 60, GRID_QUARTER_HEIGHT));
    onProposalChange({ startsAt: `${date}T${minuteLabel(selectedMinute)}`, durationMinutes: 60 });
  }

  function resizeGrabOffset(element: HTMLElement, clientY: number, startsAt: string, durationMinutes: number) {
    const grid = element.closest(".schedule-day-grid") as HTMLElement | null;
    if (!grid) return 0;
    const endMinute = minuteValue(startsAt.slice(11, 16)) + durationMinutes;
    const endY = grid.getBoundingClientRect().top
      + ((endMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT;
    return clientY - endY;
  }

  function startProposalResize(event: ReactPointerEvent<HTMLElement>, startsAt: string, durationMinutes: number) {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.dataset.resizePointerId = String(event.pointerId);
    event.currentTarget.dataset.resizeGrabOffsetPx = String(resizeGrabOffset(event.currentTarget, event.clientY, startsAt, durationMinutes));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishProposalResize(event: ReactPointerEvent<HTMLElement>) {
    resizeProposalFromPointer(event);
    delete event.currentTarget.dataset.resizePointerId;
    delete event.currentTarget.dataset.resizeGrabOffsetPx;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelProposalResize(event: ReactPointerEvent<HTMLElement>) {
    delete event.currentTarget.dataset.resizePointerId;
    delete event.currentTarget.dataset.resizeGrabOffsetPx;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startAppointmentResize(event: ReactPointerEvent<HTMLElement>, appointment: Appointment, durationMinutes: number) {
    event.preventDefault(); event.stopPropagation(); suppressCardClickRef.current = true;
    event.currentTarget.dataset.resizeAppointmentId = appointment.id;
    event.currentTarget.dataset.resizePointerId = String(event.pointerId);
    event.currentTarget.dataset.resizeGrabOffsetPx = String(resizeGrabOffset(event.currentTarget, event.clientY, appointment.startsAt, durationMinutes));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function clearAppointmentResize(element: HTMLElement) {
    delete element.dataset.resizeAppointmentId;
    delete element.dataset.resizePointerId;
    delete element.dataset.resizeGrabOffsetPx;
    window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
  }

  function finishAppointmentResize(event: ReactPointerEvent<HTMLElement>, appointment: Appointment) {
    resizeAppointmentFromPointer(event, appointment);
    clearAppointmentResize(event.currentTarget);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelAppointmentResize(event: ReactPointerEvent<HTMLElement>) {
    clearAppointmentResize(event.currentTarget);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeProposalFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if (Number(event.currentTarget.dataset.resizePointerId) !== event.pointerId || !proposal || !onProposalChange) return;
    const grid = event.currentTarget.closest(".schedule-day-grid") as HTMLElement | null;
    if (!grid) return;
    const requestedEndMinute = scheduleMinuteFromGridPosition(
      event.clientY - Number(event.currentTarget.dataset.resizeGrabOffsetPx || 0) - grid.getBoundingClientRect().top,
      gridStartMinute, gridEndMinute, 0, GRID_QUARTER_HEIGHT,
    );
    const startMinute = minuteValue(proposal.startsAt.slice(11, 16));
    const durationMinutes = scheduleProposalDurationFromEndMinute(startMinute, requestedEndMinute, gridEndMinute);
    if (durationMinutes !== proposal.durationMinutes) onProposalChange({ startsAt: proposal.startsAt, durationMinutes });
  }

  function resizeProposalFromKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    if (!proposal || !onProposalChange) return;
    const startMinute = minuteValue(proposal.startsAt.slice(11, 16));
    const maximum = scheduleProposalDurationFromEndMinute(startMinute, gridEndMinute, gridEndMinute);
    let durationMinutes = proposal.durationMinutes;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") durationMinutes -= 15;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") durationMinutes += 15;
    else if (event.key === "PageUp") durationMinutes -= 60;
    else if (event.key === "PageDown") durationMinutes += 60;
    else if (event.key === "Home") durationMinutes = APPOINTMENT_MIN_DURATION_MINUTES;
    else if (event.key === "End") durationMinutes = maximum;
    else return;
    event.preventDefault(); event.stopPropagation();
    durationMinutes = Math.max(APPOINTMENT_MIN_DURATION_MINUTES, Math.min(maximum, durationMinutes));
    if (durationMinutes !== proposal.durationMinutes) onProposalChange({ startsAt: proposal.startsAt, durationMinutes });
  }

  function resizeAppointmentFromPointer(event: ReactPointerEvent<HTMLElement>, appointment: Appointment) {
    if (Number(event.currentTarget.dataset.resizePointerId) !== event.pointerId
      || event.currentTarget.dataset.resizeAppointmentId !== appointment.id) return;
    const grid = event.currentTarget.closest(".schedule-day-grid") as HTMLElement | null;
    if (!grid) return;
    const requestedEndMinute = scheduleMinuteFromGridPosition(
      event.clientY - Number(event.currentTarget.dataset.resizeGrabOffsetPx || 0) - grid.getBoundingClientRect().top,
      gridStartMinute, gridEndMinute, 0, GRID_QUARTER_HEIGHT,
    );
    const startMinute = minuteValue(appointment.startsAt.slice(11, 16));
    const durationMinutes = scheduleProposalDurationFromEndMinute(startMinute, requestedEndMinute, gridEndMinute);
    if (durationMinutes !== appointmentDurationMinutes(appointment.startsAt, appointment.endsAt)) {
      stageScheduleChange(appointment, appointment.startsAt.slice(0, 10), startMinute, appointment.assigneeMemberId, durationMinutes);
    }
  }

  function resizeAppointmentFromKeyboard(event: ReactKeyboardEvent<HTMLElement>, appointment: Appointment) {
    const startMinute = minuteValue(appointment.startsAt.slice(11, 16));
    const currentDuration = appointmentDurationMinutes(appointment.startsAt, appointment.endsAt);
    const maximum = scheduleProposalDurationFromEndMinute(startMinute, gridEndMinute, gridEndMinute);
    let durationMinutes = currentDuration;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") durationMinutes -= 15;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") durationMinutes += 15;
    else if (event.key === "PageUp") durationMinutes -= 60;
    else if (event.key === "PageDown") durationMinutes += 60;
    else if (event.key === "Home") durationMinutes = APPOINTMENT_MIN_DURATION_MINUTES;
    else if (event.key === "End") durationMinutes = maximum;
    else return;
    event.preventDefault(); event.stopPropagation();
    durationMinutes = Math.max(APPOINTMENT_MIN_DURATION_MINUTES, Math.min(maximum, durationMinutes));
    if (durationMinutes !== currentDuration) {
      stageScheduleChange(appointment, appointment.startsAt.slice(0, 10), startMinute, appointment.assigneeMemberId, durationMinutes);
    }
  }

  function stageScheduleChange(
    appointment: Appointment,
    targetDate: string,
    targetMinute: number,
    memberId = appointment.assigneeMemberId,
    durationMinutes = appointmentDurationMinutes(appointment.startsAt, appointment.endsAt),
  ) {
    if (!canRescheduleJobs) return;
    if (targetDate < minimumStart.slice(0, 10)) { setStatus("Appointments cannot be moved into the past."); return; }
    try {
      const targetStart = `${targetDate}T${minuteLabel(targetMinute)}`;
      const moved = moveAppointmentToDate(targetStart, appointmentEndsAt(targetStart, durationMinutes), targetDate, minimumStart);
      const authoritative = pendingScheduleChanges[appointment.id]?.appointment
        || authoritativeAppointmentsById.get(appointment.id) || appointment;
      const unchanged = memberId === authoritative.assigneeMemberId
        && moved.startsAt === authoritative.startsAt
        && durationMinutes === appointmentDurationMinutes(authoritative.startsAt, authoritative.endsAt);
      if (!unchanged && !pendingScheduleChanges[appointment.id] && Object.keys(pendingScheduleChanges).length >= 5) {
        setStatus("Save or discard the five pending changes before moving another appointment.");
        return;
      }
      setPendingScheduleChanges((current) => {
        const next = { ...current };
        if (unchanged) delete next[appointment.id];
        else next[appointment.id] = { appointment: authoritative, appointmentId: appointment.id, memberId, startsAt: moved.startsAt, durationMinutes };
        return next;
      });
      setEdits((current) => ({ ...current, [appointment.id]: editFromRange(memberId, moved.startsAt, appointmentEndsAt(moved.startsAt, durationMinutes)) }));
      const targetWeek = monday(new Date(`${targetDate}T12:00:00`));
      if (scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, targetWeek)) {
        setActiveWeekStart(targetWeek);
      } else {
        const targetRangeStart = addDays(targetWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7);
        setData((current) => ({
          ...current,
          rangeStart: targetRangeStart,
          rangeEnd: addDays(targetRangeStart, SCHEDULE_BUFFER_WEEKS * 7),
          rangeWeeks: SCHEDULE_BUFFER_WEEKS,
        }));
        setRangeStart(targetRangeStart);
        setActiveWeekStart(targetWeek);
      }
      setStatus(unchanged ? `${appointment.workNumber} restored to its saved time.` : `${appointment.workNumber} moved here as an unsaved change.`);
    } catch (error) {
      setStatus(error instanceof Error && error.message === "PAST_APPOINTMENT" ? "There is no future time left in that day. Choose another day." : "That appointment could not be moved.");
    }
  }

  async function saveScheduleChanges() {
    if (!pendingScheduleChangeCount || pendingScheduleHasConflict || loading || loadError) return;
    const changes = Object.values(pendingScheduleChanges).map((change) => ({
      appointmentId: change.appointmentId,
      memberId: change.memberId,
      startsAt: change.startsAt,
      durationMinutes: change.durationMinutes,
      expectedRevision: change.appointment.revision,
    }));
    const saved = await update({ action: "save_schedule_changes", changes }, "schedule-batch",
      `${changes.length} ${changes.length === 1 ? "appointment" : "appointments"} saved.`);
    if (!saved) return;
    setPendingScheduleChanges({});
    setEdits({});
    await onScheduleChanged?.();
  }

  function discardScheduleChanges() {
    setPendingScheduleChanges({});
    setEdits({});
    setStatus("Unsaved schedule changes discarded.");
  }

  if (loading && !data.ok) return <section className={`dashboard-panel schedule-workspace${jobCalendar ? " job-calendar" : ""}`}><div className="crm-empty"><strong>Building the schedule</strong><span>Loading the authorised appointments for this week.</span></div></section>;
  return <section className={`dashboard-panel schedule-workspace${jobCalendar ? " job-calendar" : ""}`} aria-busy={loading}>
    <header className="schedule-heading"><div><span>{jobCalendar ? schedulePermissions?.scheduleScope === "own" ? "Your calendar" : "Team calendar" : "Dispatch calendar"}</span><h2>{jobCalendar ? "Check the week before you book" : "One clear week at a time"}</h2><p>{jobCalendar ? schedulePermissions?.scheduleScope === "own" ? "Your access shows only appointments assigned to you." : "See authorised team work and conflicts while you choose this job's person and time." : "See the week, move work quickly and open any appointment for precise details."}</p></div><div className="schedule-week-nav"><button type="button" disabled={loading} onClick={() => goToWeek(adjacentScheduleWeek(activeWeekStart, -1))}>Previous week</button><button className="schedule-today-button" type="button" disabled={loading} onClick={goToToday}>Today</button><label><span>Go to week</span><input type="date" value={activeWeekStart} disabled={loading} onChange={(event) => { if (event.target.value) goToWeek(event.target.value); }} /></label><strong className="schedule-week-range" onTouchStart={startWeekSwipe} onTouchEnd={finishWeekSwipe}>{formatDay(activeWeekStart)} to {formatDay(addDays(activeWeekStart, 6))}<small>Swipe to change week</small></strong><button type="button" disabled={loading} onClick={() => goToWeek(adjacentScheduleWeek(activeWeekStart, 1))}>Next week</button></div></header>
    {jobCalendar && (members.length > 1 || Boolean(memberFilter && !members.some((member) => member.id === memberFilter))) && <div className="job-calendar-person-filter"><label><span>Show calendar</span><select value={memberFilter} onChange={(event) => { onProposalValidation?.(invalidateScheduleProposal(proposalValidation.key)); setMemberFilter(event.target.value); }}><option value="">All workers</option>{memberFilter && !members.some((member) => member.id === memberFilter) && <option value={memberFilter}>{proposal?.assigneeLabel || "Assigned worker"} (unavailable)</option>}{members.map((member) => <option key={member.id} value={member.id}>{scheduleMemberLabel(member, data.access?.memberId || "")}</option>)}</select></label><small>{memberFilter ? "Showing one worker. Booking checks use the worker selected for this job." : "Showing all workers allowed by your team access."}</small></div>}
    {!jobCalendar && <section className="schedule-today-strip" aria-labelledby="schedule-today-title"><header><div><span>Today</span><strong id="schedule-today-title">{formatDay(todayDate)}</strong></div><b>{todayInRange ? `${todayAppointments.length} ${todayAppointments.length === 1 ? "appointment" : "appointments"}` : "Outside this week"}</b></header><div className="schedule-today-list">{todayInRange ? <>{todayAppointments.map((item) => <button type="button" key={item.id} onClick={(event) => { goToToday(); openAppointment(item.id, event.currentTarget); }}><strong>{formatTime(item.startsAt)} | {item.customerDisplayName}</strong><span>{item.assigneeLabel || "Unassigned"} | {item.suburbLabel}</span></button>)}{!todayAppointments.length && <p>No appointments today. Use the waiting jobs section below to add work.</p>}</> : <button type="button" onClick={goToToday}><strong>{"Load today's work"}</strong><span>Open the current week and jump straight to today.</span></button>}</div></section>}
    {!jobCalendar && <details className="schedule-filter-panel"><summary><span>Schedule filters</span><strong>{memberFilter || jobFilter || serviceFilter || siteFilter || statusFilter || conflictOnly ? "Filters active" : "Everyone and all work"}</strong></summary><div className="schedule-filters"><label><span>Person</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Job or customer</span><input value={jobFilter} placeholder="Customer, suburb or reference" onChange={(event) => setJobFilter(event.target.value)} /></label><label><span>Service</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service}>{readable(service)}</option>)}</select></label><label><span>Site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All schedule states</option><option value="scheduled">Scheduled</option><option value="conflict">Conflicts</option><option value="awaiting">Awaiting appointment</option><option value="unassigned">Unassigned</option></select></label><label className="schedule-check"><input type="checkbox" checked={conflictOnly} onChange={(event) => setConflictOnly(event.target.checked)} /><span>Conflicts only</span></label></div></details>}
    {!jobCalendar && (data.rescheduleRequests || []).length > 0 && <details className="schedule-reschedule-queue"><summary><span>Customer requests</span><strong>{canRescheduleJobs ? "Review before changing the schedule" : "View requests"} | {data.rescheduleRequests?.length}</strong></summary><div>{data.rescheduleRequests?.map((request) => {
      const preferred = request.preferredWindows[0]; const baseStart = request.proposedStartsAt || preferred?.startsAt || request.currentStartsAt; const baseEnd = request.proposedEndsAt || preferred?.endsAt || request.currentEndsAt;
      const edit = edits[request.id] || editFromRange(request.proposedAssigneeMemberId || request.currentAssigneeMemberId, baseStart, baseEnd); const startsAt = editStart(edit); const invalidTime = startsAt <= minimumStart;
      return <article key={request.id}><header><div><span>{request.workNumber} | {readable(request.status)}</span><strong>{request.title}</strong><small>Current: {request.currentStartsAt} | {durationLabel(appointmentDurationMinutes(request.currentStartsAt, request.currentEndsAt))}</small></div></header><p><strong>Reason</strong>{request.reason}</p>{request.accessNotes && <p><strong>Access notes</strong>{request.accessNotes}</p>}{canRescheduleJobs && <><div className="schedule-request-decision">{canAssignJobs ? <select aria-label={`Assigned staff for request ${request.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select> : <span>{request.currentAssigneeLabel || "Assigned worker"}</span>}<input type="datetime-local" min={minimumStart} step="900" aria-label={`Reviewed start for ${request.workNumber}`} value={startsAt} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, date: event.target.value.slice(0, 10), time: event.target.value.slice(11, 16) } }))} /><DurationControl id={`request-duration-${request.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [request.id]: { ...edit, durationMinutes } }))} /><input maxLength={500} value={decisionNotes[request.id] || ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Optional customer-facing response" /></div><div className="schedule-request-actions"><button type="button" disabled={busy === `reject:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "rejected", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "" }, `reject:${request.id}`, `${request.workNumber} request rejected without changing the schedule.`)}>Reject</button><button type="button" disabled={!edit.memberId || invalidTime || busy === `alternative:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "alternative_proposed", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `alternative:${request.id}`, `${request.workNumber} alternative proposed without changing the schedule.`)}>Propose alternative</button><button className="primary" type="button" disabled={!edit.memberId || invalidTime || busy === `accept:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "accepted", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `accept:${request.id}`, `${request.workNumber} appointment change accepted.`)}>Accept and reschedule</button></div></>}</article>;
    })}</div></details>}
    {pendingScheduleChangeCount > 0 && <section className={`schedule-pending-actions${pendingScheduleHasConflict ? " conflict" : ""}`} aria-label="Unsaved schedule changes"><div><strong>{pendingScheduleChangeCount} unsaved {pendingScheduleChangeCount === 1 ? "schedule change" : "schedule changes"}</strong><span>{pendingScheduleHasConflict ? "Resolve the highlighted same-worker overlap or unavailable time before saving." : "Review every moved appointment, then save them together."}</span></div><button type="button" onClick={discardScheduleChanges} disabled={busy === "schedule-batch"}>Discard</button><button type="button" className="primary" onClick={() => void saveScheduleChanges()} disabled={pendingScheduleHasConflict || loading || Boolean(loadError) || busy === "schedule-batch"}>{busy === "schedule-batch" ? "Saving..." : "Save schedule changes"}</button></section>}
    <p className="schedule-drag-note" id={jobCalendar ? proposalStatusId : undefined} role={jobCalendar ? "status" : undefined} aria-live={jobCalendar ? "polite" : undefined}>{jobCalendar ? proposalGuidance : canRescheduleJobs ? "Drag appointments into the best order, then save all schedule changes together." : "This schedule is read only for your access."} {!jobCalendar && "Tap or press Enter for exact details."} {jobCalendar && onProposalChange && "Double-click an open time to select one hour. Drag the proposed booking to move it, or drag its bottom edge to change its length in 15 minute steps."} {calendarCanReschedule && " On a phone, tap a job to change its day, start time, worker or duration."} {jobCalendar && proposalValidation.status === "not_visible" && proposal?.startsAt && <button type="button" onClick={showProposal}>Show selected booking</button>} {jobCalendar && proposalValidation.status === "load_error" && <button type="button" onClick={retryProposalWeek}>Retry selected week</button>}</p>
    <div className="schedule-week-viewport" onTouchStart={startWeekSwipe} onTouchEnd={(event) => finishWeekSwipe(event, true)} onTouchCancel={() => { weekSwipeStartRef.current = null; }} onDragOver={(event) => { if (draggingId) autoScrollDuringDrag(event.clientX, event.clientY); }}>
      {draggingId && <><span className={`schedule-drag-edge previous${dragEdgeDirection === -1 ? " active" : ""}`}>Hold for previous week</span><span className={`schedule-drag-edge next${dragEdgeDirection === 1 ? " active" : ""}`}>Hold for next week</span></>}
      <div className="schedule-week-pages" style={{ transform: `translateX(-${activeWeekIndex * 100}%)` }}>
      {bufferedWeekStarts.map((bufferedWeekStart) => {
        const days = scheduleWeekDays(bufferedWeekStart);
        const pageIsActive = bufferedWeekStart === activeWeekStart;
        return <section key={bufferedWeekStart} className="schedule-week-page" aria-hidden={!pageIsActive}>
        <div ref={pageIsActive ? timetableScrollRef : undefined} className="schedule-timetable-scroll" onDragOver={(event) => { if (draggingId) autoScrollDuringDrag(event.clientX, event.clientY); }}>
        <div className="schedule-timetable">
        <div className="schedule-time-rail" style={{ background: "#fff", left: 0, position: "sticky", zIndex: 20 }}><div className="schedule-time-heading">Time</div><div className="schedule-time-track" style={{ height: `${gridHeight}px` }}>{timeLabels.map((minute) => <span className={minute === gridStartMinute ? "first" : minute === gridEndMinute ? "last" : undefined} key={minute} style={{ top: `${((minute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`2000-01-01T${minuteLabel(minute)}`)}</span>)}</div></div>
        {days.map((date) => {
          const dayIsPast = date < minimumStart.slice(0, 10);
          const dayIsToday = date === todayDate;
          const dayAppointments = appointmentsByDate.get(date) || [];
          const dayUnavailability = activeWeekUnavailability.filter((item) => item.startsAt.slice(0, 10) === date);
          const proposalOnDay = proposal?.startsAt.slice(0, 10) === date && proposalEndsAt && proposal.assigneeMemberId && (!memberFilter || memberFilter === proposal.assigneeMemberId)
            ? { id: "job-schedule-proposal", startsAt: proposal.startsAt, endsAt: proposalEndsAt }
            : null;
          const laneItems = [...dayAppointments, ...dayUnavailability, ...(proposalOnDay ? [proposalOnDay] : [])];
          const appointmentLanes = scheduleAppointmentLanes(laneItems);
          return <section key={date} aria-label={`${dayIsToday ? "Today, " : ""}${formatDay(date)}`} className={`schedule-day-track${dropTarget === date ? " drop-target" : ""}${dayIsPast ? " past" : ""}${dayIsToday ? " today" : ""}`}>
            <header aria-current={dayIsToday ? "date" : undefined}><strong>{dayIsToday ? "Today" : shortDays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</strong><span>{date.slice(5)}</span></header>
            <div data-schedule-date={date} className={`schedule-day-grid${jobCalendar && onProposalChange && !dayIsPast ? " proposal-selectable" : ""}`} style={{ height: `${gridHeight}px` }}
              onDoubleClick={(event) => { selectProposalFromCalendar(event.currentTarget, date, event.clientY); }}
              onDragOver={(event) => {
                const appointment = draggedAppointmentRef.current || appointmentsById.get(draggingId);
                const duration = appointment ? appointmentDurationMinutes(appointment.startsAt, appointment.endsAt) : draggedProposalRef.current && proposal ? proposal.durationMinutes : 0;
                if (!dayIsPast && duration) {
                  event.preventDefault(); autoScrollDuringDrag(event.clientX, event.clientY); setDropTarget(date);
                  setDropMinute(minuteFromPointer(event.currentTarget, event.clientY, duration));
                }
              }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(""); }}
              onDrop={(event) => { event.preventDefault(); clearDragEdge(); if (draggedProposalRef.current && proposal && onProposalChange) { const minute = minuteFromPointer(event.currentTarget, event.clientY, proposal.durationMinutes); onProposalChange({ startsAt: `${date}T${minuteLabel(minute)}`, durationMinutes: proposal.durationMinutes }); draggedProposalRef.current = false; dragDropCommittedRef.current = true; setDraggingId(""); setDropTarget(""); return; } const appointment = draggedAppointmentRef.current || appointmentsById.get(draggingId || event.dataTransfer.getData("text/plain")); if (appointment) { dragDropCommittedRef.current = true; stageScheduleChange(appointment, date, minuteFromPointer(event.currentTarget, event.clientY, appointmentDurationMinutes(appointment.startsAt, appointment.endsAt))); } }}>
              {dayIsToday && nowMinute >= gridStartMinute && nowMinute <= gridEndMinute && <span className="schedule-now-line" style={{ top: `${((nowMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}><i>Now</i></span>}
              {dropTarget === date && <span className="schedule-drop-guide" style={{ top: `${((dropMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`${date}T${minuteLabel(dropMinute)}`)}</span>}
              {dayUnavailability.map((item) => {
                const startMinute = minuteValue(item.startsAt.slice(11, 16));
                const duration = Math.max(15, (Date.parse(`${item.endsAt}:00Z`) - Date.parse(`${item.startsAt}:00Z`)) / 60_000);
                const lane = appointmentLanes.get(item.id) || { lane: 0, laneCount: 1 };
                const label = members.find((member) => member.id === item.teamMemberId)?.displayName || "Team member";
                return <article key={item.id} aria-label={`${label} unavailable from ${formatTime(item.startsAt)}`} className="schedule-block unavailable" style={{ top: `${Math.max(0, ((startMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT)}px`, height: `${Math.max(44, (duration / 15) * GRID_QUARTER_HEIGHT)}px`, left: `calc(${lane.lane * 100 / lane.laneCount}% + 4px)`, right: "auto", width: `calc(${100 / lane.laneCount}% - 8px)` }}><strong>Unavailable</strong><small>{label}</small><span>{formatTime(item.startsAt)} | busy time</span></article>;
              })}
              {dayAppointments.map((item) => {
                const startMinute = minuteValue(item.startsAt.slice(11, 16)); const duration = appointmentDurationMinutes(item.startsAt, item.endsAt); const top = Math.max(0, ((startMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT); const height = scheduleAppointmentBlockHeight(duration, GRID_QUARTER_HEIGHT);
                const lane = appointmentLanes.get(item.id) || { lane: 0, laneCount: 1 };
                const cardLabel = `${item.customerDisplayName}, ${item.assigneeLabel || "Unassigned"}, ${item.suburbLabel}, ${formatTime(item.startsAt)}`;
                const proposalConflict = proposalValidation.status === "conflict" && proposalConflictIds.has(item.id);
                const pendingConflict = pendingConflictIds.has(item.id) || pendingUnavailableIds.has(item.id);
                const effectiveConflict = item.scheduleDraft ? pendingConflict : item.conflicts || pendingConflict;
                const maximumDuration = scheduleProposalDurationFromEndMinute(startMinute, gridEndMinute, gridEndMinute);
                const left = `calc(${lane.lane * 100 / lane.laneCount}% + 4px)`;
                const width = `calc(${100 / lane.laneCount}% - 8px)`;
                const resizeWidth = `min(32px, calc(${100 / lane.laneCount}% - 8px))`;
                const resizeLeft = `max(calc(${lane.lane * 100 / lane.laneCount}% + 4px), calc(${(lane.lane + 1) * 100 / lane.laneCount}% - 36px))`;
                return <Fragment key={item.id}><article data-schedule-appointment draggable={calendarCanReschedule && !busy && !loading} tabIndex={pageIsActive ? 0 : -1} role="button" aria-label={`View appointment for ${cardLabel}`} className={`schedule-block moveable ${colourFor(item.assigneeMemberId)}${height < 62 ? " compact" : ""}${height <= 16 ? " micro" : ""}${effectiveConflict || proposalConflict ? " conflict" : ""}${item.scheduleDraft ? " draft" : ""}${selectedAppointmentId === item.id ? " selected" : ""}${draggingId === item.id ? " dragging" : ""}`} style={{ top: `${top}px`, height: `${height}px`, left, right: "auto", width }}
                  onClick={(event) => openAppointment(item.id, event.currentTarget)}
                  onDoubleClick={(event) => { event.stopPropagation(); leaveSchedule(() => onOpenJob(item.workOrderId)); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openAppointment(item.id, event.currentTarget); } }}
                  onDragStart={(event) => { suppressCardClickRef.current = true; draggedAppointmentRef.current = item; dragDropCommittedRef.current = false; dragEdgeLockRef.current = 0; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingId(item.id); setDropMinute(startMinute); }}
                  onDragEnd={() => { const dragged = draggedAppointmentRef.current; clearDragEdge(true); if (dragged && !dragDropCommittedRef.current) { const sourceWeek = monday(new Date(`${dragged.startsAt.slice(0, 10)}T12:00:00`)); setActiveWeekStart(sourceWeek); if (!scheduleRangeContainsWeek(displayRangeStart, SCHEDULE_BUFFER_WEEKS, sourceWeek)) setRangeStart(addDays(sourceWeek, -SCHEDULE_BUFFER_LEADING_WEEKS * 7)); } draggedAppointmentRef.current = null; dragDropCommittedRef.current = false; setDraggingId(""); setDropTarget(""); setDropMinute(gridStartMinute); window.setTimeout(() => { suppressCardClickRef.current = false; }, 0); }}>
                  <strong>{item.customerDisplayName}</strong><small>{item.assigneeLabel || "Unassigned"}</small><em>{item.suburbLabel}</em><span>{formatTime(item.startsAt)} | {durationLabel(duration)}</span>{item.scheduleDraft && <b>Unsaved</b>}{item.outsideWorkingHours && <b>Outside hours</b>}{effectiveConflict && <b>Conflict</b>}{proposalConflict && <b>Overlaps selected time</b>}
                </article>{calendarCanReschedule && !busy && !loading && <span
                  data-schedule-appointment data-schedule-appointment-resize className="schedule-appointment-resize"
                  style={{ top: `${top + height - 16}px`, left: resizeLeft, right: "auto", width: resizeWidth }}
                  role="slider" tabIndex={pageIsActive ? 0 : -1} aria-label={`Resize appointment for ${item.customerDisplayName}`}
                  aria-orientation="vertical" aria-valuemin={APPOINTMENT_MIN_DURATION_MINUTES} aria-valuemax={maximumDuration}
                  aria-valuenow={duration} aria-valuetext={durationLabel(duration)}
                  onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => startAppointmentResize(event, item, duration)}
                  onPointerMove={(event) => resizeAppointmentFromPointer(event, item)}
                  onPointerUp={(event) => finishAppointmentResize(event, item)}
                  onPointerCancel={(event) => cancelAppointmentResize(event)}
                  onLostPointerCapture={cancelAppointmentResize}
                  onKeyDown={(event) => resizeAppointmentFromKeyboard(event, item)}><i aria-hidden="true" />
                </span>}</Fragment>;
              })}
              {proposalOnDay && (() => {
                const startMinute = minuteValue(proposalOnDay.startsAt.slice(11, 16));
                const duration = appointmentDurationMinutes(proposalOnDay.startsAt, proposalOnDay.endsAt);
                const lane = appointmentLanes.get(proposalOnDay.id) || { lane: 0, laneCount: 1 };
                const maximumDuration = scheduleProposalDurationFromEndMinute(startMinute, gridEndMinute, gridEndMinute);
                const top = Math.max(0, ((startMinute - gridStartMinute) / 15) * GRID_QUARTER_HEIGHT);
                const height = scheduleAppointmentBlockHeight(duration, GRID_QUARTER_HEIGHT);
                const left = `calc(${lane.lane * 100 / lane.laneCount}% + 4px)`;
                const width = `calc(${100 / lane.laneCount}% - 8px)`;
                const resizeWidth = `min(32px, calc(${100 / lane.laneCount}% - 8px))`;
                const resizeLeft = `max(calc(${lane.lane * 100 / lane.laneCount}% + 4px), calc(${(lane.lane + 1) * 100 / lane.laneCount}% - 36px))`;
                return <><article data-schedule-proposal draggable={Boolean(onProposalChange) && !busy && !loading} tabIndex={onProposalChange && pageIsActive ? 0 : -1} aria-label={`Proposed booking for ${proposal?.title || "this job"}. Drag to move it.`} onDoubleClick={(event) => event.stopPropagation()} onDragStart={(event) => { draggedProposalRef.current = true; draggedAppointmentRef.current = null; dragDropCommittedRef.current = false; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "job-schedule-proposal"); setDraggingId("job-schedule-proposal"); setDropMinute(startMinute); }} onDragEnd={() => { clearDragEdge(true); draggedProposalRef.current = false; dragDropCommittedRef.current = false; setDraggingId(""); setDropTarget(""); setDropMinute(gridStartMinute); }} className={`schedule-block moveable proposal ${colourFor(proposal?.assigneeMemberId || "")}${proposalHasConflict ? " conflict" : ""}${draggingId === "job-schedule-proposal" ? " dragging" : ""}`} style={{ top: `${top}px`, height: `${height}px`, left, right: "auto", width }}><strong>{proposal?.title || "This job"}</strong><small>{proposal?.assigneeLabel || "Selected person"}</small><em>Proposed booking</em><span>{formatTime(proposalOnDay.startsAt)} | {durationLabel(duration)}</span>{proposalHasConflict && <b>{proposalValidation.status === "unavailable" ? "Unavailable" : "Conflict"}</b>}</article>{onProposalChange && <span
                  data-schedule-proposal className="schedule-proposal-resize"
                  style={{ top: `${top + height - 16}px`, left: resizeLeft, right: "auto", width: resizeWidth }}
                  role="slider" tabIndex={pageIsActive ? 0 : -1} aria-label="Resize proposed booking"
                  aria-orientation="vertical" aria-valuemin={APPOINTMENT_MIN_DURATION_MINUTES} aria-valuemax={maximumDuration}
                  aria-valuenow={duration} aria-valuetext={durationLabel(duration)} onDoubleClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => startProposalResize(event, proposalOnDay.startsAt, duration)}
                  onPointerMove={resizeProposalFromPointer}
                  onPointerUp={finishProposalResize}
                  onPointerCancel={cancelProposalResize}
                  onLostPointerCapture={cancelProposalResize}
                  onKeyDown={resizeProposalFromKeyboard}><i aria-hidden="true" />
                </span>}</>;
              })()}
              {dayIsToday && !dayAppointments.length && !dayUnavailability.length && !proposalOnDay && <span className="schedule-free-day">No jobs today</span>}
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
      const siteAddress = appointmentSiteAddress(selectedAppointment);
      return <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeAppointment(); }}>
        <section ref={appointmentDialogRef} className="crm-invoice-preview-dialog schedule-appointment-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-appointment-title" aria-describedby="schedule-appointment-summary">
          <header><div><span>Appointment details</span><strong id="schedule-appointment-title">{selectedAppointment.customerDisplayName}</strong><small>{selectedAppointment.assigneeLabel || "Unassigned"} | {selectedAppointment.suburbLabel}</small></div><button type="button" className="schedule-dialog-close" autoFocus onClick={closeAppointment} aria-label="Close appointment details">&times;</button></header>
          <div className="schedule-selection" style={{ border: 0, borderRadius: 0, overflowY: "auto" }}>
            <p id="schedule-appointment-summary"><strong>{selectedAppointment.title}</strong><br />{readable(selectedAppointment.serviceCategory)} | {selectedAppointment.siteSummary || selectedAppointment.siteLabel}<br />Job reference {selectedAppointment.workNumber}{selectedAppointment.scheduleDraft ? <><br /><b>Unsaved schedule change</b></> : null}</p>
            <dl className="schedule-appointment-details"><div><dt>Type</dt><dd>{readable(selectedAppointment.appointmentType)}</dd></div><div><dt>Status</dt><dd>{readable(selectedAppointment.status)}</dd></div><div><dt>Starts</dt><dd>{formatDay(selectedAppointment.startsAt.slice(0, 10))}, {formatTime(selectedAppointment.startsAt)}</dd></div><div><dt>Ends</dt><dd>{formatDay(selectedAppointment.endsAt.slice(0, 10))}, {formatTime(selectedAppointment.endsAt)}</dd></div><div><dt>Duration</dt><dd>{durationLabel(appointmentDurationMinutes(selectedAppointment.startsAt, selectedAppointment.endsAt))}</dd></div><div><dt>Worker</dt><dd>{selectedAppointment.assigneeLabel || "Unassigned"}</dd></div><div><dt>Site</dt><dd>{selectedAppointment.siteLabel || selectedAppointment.suburbLabel}</dd></div></dl>
            {siteAddress && <p className="schedule-appointment-contact"><strong>Service address</strong><span>{siteAddress}</span><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(siteAddress)}`} target="_blank" rel="noreferrer">Open directions</a></p>}
            {(selectedAppointment.customerPhone || selectedAppointment.customerEmail) && <p className="schedule-appointment-contact"><strong>Customer contact</strong>{selectedAppointment.customerPhone && <a href={`tel:${selectedAppointment.customerPhone.replace(/[^+\d]/g, "")}`}>{selectedAppointment.customerPhone}</a>}{selectedAppointment.customerEmail && <a href={`mailto:${selectedAppointment.customerEmail}`}>{selectedAppointment.customerEmail}</a>}</p>}
            {selectedAppointment.notes && <p className="schedule-appointment-notes"><strong>Visit notes</strong><span>{selectedAppointment.notes}</span></p>}
            <div className="schedule-quote-summary"><span><small>Quote</small><strong>{readable(selectedAppointment.quoteStatus || "not_started")}</strong></span><b>{money(selectedAppointment.quotedValueCents || 0)}</b></div>
            {calendarCanReschedule && <div className="schedule-selection-fields">{canAssignJobs ? <label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label> : <span>{selectedAppointment.assigneeLabel || "Assigned worker"}</span>}<label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`appointment-duration-${selectedAppointment.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, durationMinutes } }))} /></div>}
            {status && <p className="crm-status schedule-dialog-status" role="status">{status}</p>}
          </div>
          <footer><button type="button" onClick={() => leaveSchedule(() => onOpenJob(selectedAppointment.workOrderId))}>Open full job</button>{onOpenQuote && !selectedAppointment.protectedJob && <button className="schedule-secondary" type="button" onClick={() => leaveSchedule(() => onOpenQuote(selectedAppointment.workOrderId))}>Open quote</button>}{calendarCanReschedule && <button className="primary" type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === "schedule-batch"} onClick={() => { stageScheduleChange(selectedAppointment, edit.date, minuteValue(edit.time), edit.memberId, edit.durationMinutes); closeAppointment(); }}>Stage schedule change</button>}</footer>
        </section>
      </div>;
    })()}
    {!jobCalendar && <details className="schedule-capacity"><summary><span>Team capacity</span><strong>Week of {activeWeekStart} | {unassignedCount} jobs waiting</strong></summary><div>{capacity.map(({ member, available, booked, percent }) => <article key={member.id}><span><i className={`schedule-person-dot ${colourFor(member.id)}`} />{memberLabel(member)}<small>{member.isOwner ? "Owner" : "Team member"}</small></span><strong>{Math.round(booked / 60)}h booked of {Math.round(available / 60)}h</strong><div><i style={{ width: `${percent}%` }} /></div></article>)}</div></details>}
    {!jobCalendar && !permissions && <details className="schedule-calendar-links"><summary><span>Calendar apps</span><strong>Google Calendar and Outlook</strong></summary><div><p>TLink stays authoritative. Connected calendars receive this week&apos;s job blocks and never control the TLink schedule.</p>{calendars.map((provider) => <article key={provider.provider}><div><strong>{provider.label}</strong><span>{provider.status === "connected" ? provider.lastError ? "Connected, last sync needs attention" : "Connected" : provider.configured ? "Available to connect" : "TLink setup in progress"}</span></div><button type="button" disabled={!provider.configured || provider.status === "connected" || Boolean(busy)} onClick={() => void connectCalendar(provider)}>{provider.status === "connected" ? "Connected" : provider.configured ? `Connect ${provider.label}` : "TLink setup in progress"}</button></article>)}<button className="primary" type="button" disabled={!calendars.some((item) => item.status === "connected") || Boolean(busy)} onClick={() => void syncCalendars()}>{busy === "calendar-sync" ? "Syncing..." : "Sync this week"}</button></div></details>}
    {!jobCalendar && (canRescheduleJobs || canManageAvailability) && <div className="schedule-lower-grid">{canRescheduleJobs && <section className="schedule-unassigned"><header><div><span>Ready to schedule</span><h3>Choose a start and job length</h3></div><strong>{visibleJobs.length}</strong></header>{visibleJobs.map((job) => { const edit = edits[job.id] || initialEdit(activeWeekStart, minimumStart, job.assigneeMemberId || ownerMemberId); const startsAt = editStart(edit); return <article key={job.id}><div><span>{job.customerDisplayName} | {readable(job.priority)}</span><strong>{job.title}</strong><small>{job.suburbLabel} | {readable(job.serviceCategory)}</small></div>{canAssignJobs ? <label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label> : <span>{job.assigneeLabel || "Assigned worker"}</span>}<label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`job-duration-${job.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [job.id]: { ...edit, durationMinutes } }))} /><button type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === `job:${job.id}`} onClick={() => void update({ action: "schedule_job", workOrderId: job.id, expectedRevision: job.revision, memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `job:${job.id}`, `${job.customerDisplayName} added to the schedule.`)}>Add to schedule</button></article>; })}{!visibleJobs.length && <div className="crm-empty"><strong>No work waiting</strong><span>Every visible active job already has a scheduled appointment.</span></div>}</section>}
      {canManageAvailability && <details className="schedule-availability"><summary><span>Availability</span><strong>Set working hours and time off</strong></summary><div className="schedule-availability-content"><p>{canManageTeamAvailability ? "Manage availability for any team member." : "Manage your own availability."}</p><label><span>Person</span><select value={hoursMember} onChange={(event) => setHoursMember(event.target.value)}><option value="">Choose person</option>{availabilityMembers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>{hoursMember && <div className="schedule-hours-grid">{dayNames.map((day, weekday) => { const row = hourEdits[weekday] || { ...defaultHours(weekday), teamMemberId: hoursMember }; return <article key={day}><label><input type="checkbox" checked={row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, isAvailable: event.target.checked } }))} />{day}</label><input type="time" value={minuteLabel(row.startMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, startMinute: minuteValue(event.target.value) } }))} /><input type="time" value={minuteLabel(row.endMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, endMinute: minuteValue(event.target.value) } }))} /><button type="button" disabled={busy === `hours:${weekday}`} onClick={() => void update({ action: "save_working_hours", memberId: hoursMember, weekday, startMinute: row.startMinute, endMinute: row.endMinute, isAvailable: row.isAvailable }, `hours:${weekday}`, `${day} hours saved.`)}>Save</button></article>; })}</div>}
        {hoursMember && <form className="schedule-unavailable-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ action: "add_unavailability", memberId: hoursMember, startsAt: form.get("startsAt"), endsAt: form.get("endsAt"), reason: form.get("reason") }, "unavailable", "Unavailable time recorded."); event.currentTarget.reset(); }}><strong>Add unavailable time</strong><input name="startsAt" type="datetime-local" required /><input name="endsAt" type="datetime-local" required /><input name="reason" maxLength={200} placeholder="Leave, training or other reason" /><button disabled={busy === "unavailable"}>Add</button></form>}
        <div className="schedule-unavailable-list">{(data.unavailability || []).filter((item) => !hoursMember || item.teamMemberId === hoursMember).map((item) => <article key={item.id}><div><strong>{item.reason}</strong><span>{item.startsAt} to {item.endsAt}</span></div><button type="button" onClick={() => void update({ action: "remove_unavailability", id: item.id }, `remove:${item.id}`, "Unavailable time removed.")}>Remove</button></article>)}</div></div></details>}</div>}
    {loadError && <p className="crm-status schedule-load-error" role="alert"><span>{loadError}</span>{!(jobCalendar && proposalValidation.status === "load_error") && <button type="button" disabled={loading} onClick={() => setLoadAttemptNonce((value) => value + 1)}>{loading ? "Retrying..." : "Retry calendar"}</button>}</p>}
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}
